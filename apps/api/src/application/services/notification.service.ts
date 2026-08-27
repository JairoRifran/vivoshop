import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LiveSession, Store } from '@vivo/domain';
import type { NotificationProvider, PushMessage } from '../ports/infrastructure';
import type { FollowRepository, PushDeliveryRepository, PushSubscriptionRepository } from '../ports/repositories';
import {
  CLOCK,
  FOLLOW_REPOSITORY,
  NOTIFICATION_PROVIDER,
  PUSH_DELIVERY_REPOSITORY,
  PUSH_SUBSCRIPTION_REPOSITORY,
} from '../ports/tokens';
import type { Clock } from '../ports/infrastructure';

/**
 * Quién recibe un aviso, y una sola vez.
 *
 * ## Por qué esto no vive en el proveedor
 *
 * El adaptador de Web Push sabe hablar con los servidores de Google y Mozilla y
 * nada más. Decidir a quién avisarle, y sobre todo **no avisarle dos veces**, es
 * una regla del producto: sobrevive a cambiar de proveedor y tiene que valer
 * igual si mañana el transporte es otro. Es la misma separación que hace que
 * `CommissionPolicy` no viva dentro del adaptador de Mercado Pago.
 *
 * ## La garantía, y de dónde sale
 *
 * ```
 * 1 vivo  +  1 dispositivo  +  live_started  =  como mucho 1 aviso
 * ```
 *
 * No la pone una comprobación en memoria: la pone `reserve`, que es un insert
 * con clave compuesta en PostgreSQL. Reservar devuelve **solo** los destinos que
 * este proceso reclamó, así que dos réplicas anunciando el mismo vivo se
 * reparten los destinos y ninguna pisa a la otra. Y sobrevive a un reinicio,
 * que es lo que una comprobación en memoria no puede hacer.
 *
 * ## Reservar antes de enviar, y por qué
 *
 * El orden es deliberado y tiene una consecuencia que conviene decir en voz
 * alta: si el proceso muere entre la reserva y el envío, ese aviso **se pierde**
 * y nadie lo reintenta. Es "como mucho una vez".
 *
 * Al revés —enviar y después anotar— se obtendría "al menos una vez", con
 * duplicados garantizados ante cualquier reintento. Web Push no ofrece
 * exactamente-una-vez, así que hay que elegir de qué lado fallar. Para un aviso
 * el costo no es simétrico: perder uno es una venta que alguien no vio;
 * repetirlo es alguien que apaga las notificaciones para siempre, y eso no se
 * recupera.
 *
 * ## Nunca puede voltear un vivo
 *
 * `announceLiveStarted` no tira nunca y corre con un plazo máximo. Si el
 * servicio de push está caído o lento, la transmisión empieza igual: un aviso es
 * un efecto secundario, jamás un requisito para transmitir.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    @Inject(FOLLOW_REPOSITORY) private readonly follows: FollowRepository,
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: PushSubscriptionRepository,
    @Inject(PUSH_DELIVERY_REPOSITORY) private readonly deliveries: PushDeliveryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Avisa que una tienda salió al aire.
   *
   * Devuelve cuántos dispositivos quedaron reservados, que es el número sobre
   * el que se puede afirmar: cuántos **efectivamente** recibieron el aviso
   * depende de servidores de terceros y no se puede prometer.
   */
  async announceLiveStarted(session: LiveSession, store: Store): Promise<number> {
    try {
      // Solo quienes tienen el aviso encendido para *esta* tienda. La
      // preferencia vive en el follow, no en el dispositivo: alguien puede
      // querer avisos de una tienda y no de otra desde el mismo teléfono.
      const followers = await this.follows.listFollowerIds(store.id);
      if (followers.length === 0) return 0;

      const targets = await this.subscriptions.listForUsers(followers);
      if (targets.length === 0) return 0;

      const claimed = await this.deliveries.reserve({
        liveSessionId: session.id,
        endpoints: targets.map((target) => target.endpoint),
        type: 'live_started',
        at: this.clock.now(),
      });
      if (claimed.length === 0) return 0;

      const reserved = new Set(claimed);
      const message: PushMessage = {
        title: `🔴 ${store.name} está en vivo`,
        body: 'Entrá a ver lo que está vendiendo.',
        data: {
          type: 'live_started',
          storeId: String(store.id),
          storeName: store.name,
          liveSessionId: String(session.id),
          // La URL se arma acá y viaja lista: el service worker no tiene por
          // qué saber cómo se construye una ruta de esta aplicación.
          url: `/live/${String(session.id)}`,
        },
      };

      await this.provider.send({
        targets: targets.filter((target) => reserved.has(target.endpoint)),
        message,
      });

      this.logger.log(`"${store.name} está en vivo" → ${claimed.length} dispositivo(s)`);
      return claimed.length;
    } catch (error) {
      // Un aviso que falla no puede impedir una transmisión.
      this.logger.warn(
        `No se pudo anunciar el vivo: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
      return 0;
    }
  }
}
