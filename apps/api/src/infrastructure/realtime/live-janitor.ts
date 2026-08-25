import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { BidService } from '../../application/services/bid.service';
import { LiveService } from '../../application/services/live.service';

/**
 * How often abandoned sessions are swept up.
 *
 * Comfortably shorter than the grace period, so a session that will be closed
 * is closed within a few seconds of becoming eligible, and long enough that an
 * idle server is not doing pointless work every second.
 */
const SWEEP_INTERVAL_MS = 15_000;

/**
 * Closes broadcasts whose seller never came back, and frees reservations whose
 * winner never paid.
 *
 * Las dos cosas en el mismo barrido y no en dos porque son el mismo problema:
 * algo quedó a medias y nadie va a volver a tocarlo. Un temporizador por
 * reserva tendría el defecto que este diseño evita —no sobrevive a un reinicio,
 * y una reserva abandonada justo antes de un deploy dejaría el producto trabado
 * para siempre—.
 *
 * A single sweep rather than a timer per session, on purpose: per-session
 * timers do not survive a process restart, so a crash mid-broadcast would
 * leave a session stuck in `interrupted` with no one left to finish it. A
 * sweep reads the current state and is therefore correct after any restart.
 *
 * M01 shipped a bug where a timer kept firing after the thing it belonged to
 * was gone. The interval here is cleared in `onModuleDestroy` and `unref`'d so
 * it can never hold the process open, and overlapping runs are skipped rather
 * than queued.
 */
@Injectable()
export class LiveJanitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LiveJanitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(forwardRef(() => LiveService)) private readonly live: LiveService,
    @Inject(forwardRef(() => BidService)) private readonly bids: BidService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // Never a reason to keep Node alive for this.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposed so a test can drive one sweep without waiting for the interval. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const closed = await this.live.closeAbandonedSessions();
      if (closed > 0) {
        this.logger.log(`Cerradas ${closed} transmisiones sin retorno del emisor`);
      }

      // Devolver el stock es urgente: el producto no puede quedar trabado
      // porque alguien abandonó el checkout. Qué hacer con la puja después
      // —reabrir o cerrar— lo decide el vendedor, no el barrido.
      const expired = await this.bids.expireLapsedReservations();
      if (expired > 0) {
        this.logger.log(`Vencidas ${expired} reservas de puja sin pago`);
      }

      // Y las pujas que quedaron abiertas con el vivo ya terminado.
      const orphaned = await this.bids.closeSessionsOfEndedLives();
      if (orphaned > 0) {
        this.logger.log(`Cerradas ${orphaned} pujas de transmisiones terminadas`);
      }

      return closed + expired + orphaned;
    } catch (error) {
      // A failed sweep is not fatal: the next one sees the same state.
      this.logger.warn(`Barrido incompleto: ${String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
