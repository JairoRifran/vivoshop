import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  type DynamicModule,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/auth.guard';
import { ENV, type AppEnv } from '../config/env';
import { MemoryDatabase } from '../infrastructure/persistence/memory/memory-database';
import { PasswordService } from '../infrastructure/security/password.service';
import { asLiveSessionId } from '@vivo/domain';
import { EMAIL_PROVIDER, PUSH_DELIVERY_REPOSITORY } from '../application/ports/tokens';
import type { PushDeliveryRepository } from '../application/ports/repositories';
import type { EmailProvider } from '../application/ports/infrastructure';
import { LogEmailProvider } from '../infrastructure/providers/email.providers';
import { ApplicationModule } from '../application/application.module';
import { PaymentService } from '../application/services/payment.service';

/**
 * Devolver el mundo al estado sembrado, entre pruebas.
 *
 * ## Por qué existe
 *
 * El E2E corría contra una API compartida por toda la suite, así que cada spec
 * heredaba lo que el anterior había dejado: una puja con pedido, un pedido a
 * medio pagar, stock consumido. El resultado dependía del orden, y peor,
 * dependía de si el servidor venía de una corrida previa. Un test que falla por
 * basura vieja miente en las dos direcciones — a veces falla sin haber roto
 * nada, a veces pasa porque el estado que necesitaba lo dejó otro.
 *
 * La alternativa era que cada spec se creara sus propios datos. Es más trabajo,
 * y además abandona lo que el conjunto sembrado aporta: los specs se leen como
 * el producto, con Ana comprándole a Martina, en vez de como una fábrica de
 * fixtures.
 *
 * ## Por qué es seguro
 *
 * El módulo **no se registra** salvo que se cumplan las tres a la vez:
 *
 *  1. `NODE_ENV=test`
 *  2. `DATA_DRIVER=memory` — no hay forma de que apunte a una base real
 *  3. `E2E_RESET_TOKEN` presente
 *
 * En producción falla la primera, y aunque alguien lograra las tres, la ruta
 * exige el token en un header y lo compara en tiempo constante. No es que sea
 * improbable llegar acá: es que la ruta no existe.
 */
@Controller('testing')
export class TestingController {
  private readonly logger = new Logger('Testing');

  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly passwords: PasswordService,
    private readonly db: MemoryDatabase,
    private readonly payments: PaymentService,
    @Inject(PUSH_DELIVERY_REPOSITORY)
    private readonly pushDeliveries: PushDeliveryRepository,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  /**
   * Vuelve a sembrar. Idempotente y sin efectos fuera del proceso.
   *
   * `force: true` limpia todo primero, incluidos pagos, pujas, cuentas de cobro
   * e idempotencia: si algo quedara, sería exactamente lo que hace que un spec
   * dependa de otro.
   */
  @Public()
  @Post('reset')
  @HttpCode(204)
  async reset(@Headers('x-e2e-reset') token?: string): Promise<void> {
    this.assertAllowed(token);

    await this.db.seed((plain) => this.passwords.hash(plain), { force: true });
    this.logger.log('Estado reiniciado al conjunto sembrado.');
  }

  /**
   * Corre el barrido de reservas vencidas, ya mismo.
   *
   * El barrido real corre cada quince segundos y decide con el TTL configurado.
   * Esperar eso en una prueba sería una espera arbitraria, y bajar el TTL a un
   * segundo haría que cualquier pedido a medio pagar de **otra** prueba
   * desapareciera por su cuenta.
   *
   * Así que se barre "como si fuera" mañana: la misma comparación de fechas,
   * el mismo camino, en el momento exacto en que la prueba lo pide.
   */
  @Public()
  @Post('sweep-reservations')
  @HttpCode(200)
  async sweep(@Headers('x-e2e-reset') token?: string): Promise<{ resolved: number }> {
    this.assertAllowed(token);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    return { resolved: await this.payments.expireLapsedCheckouts(tomorrow) };
  }

  /**
   * Cuántos avisos se decidieron para un vivo.
   *
   * El E2E no puede leer el centro de notificaciones del sistema operativo, y
   * una prueba que dependiera de eso sería frágil sin probar nada nuestro. Lo
   * que sí se puede afirmar —y es donde vive la garantía— es cuántas
   * constancias quedaron en la base.
   */
  /**
   * El último correo que se "envió".
   *
   * Sin buzón en la suite, es la única forma de que el token que usa el
   * navegador sea el real —el que salió de la base, de un solo uso y con
   * vencimiento— y no uno que la prueba se inventó.
   *
   * Solo con `EMAIL_PROVIDER=log`. Con cualquier otro devuelve 403, así que no
   * queda como una ventana a los correos de nadie.
   */
  @Public()
  @Get('last-email')
  lastEmail(@Headers('x-e2e-reset') token: string | undefined) {
    this.assertAllowed(token);

    if (!(this.email instanceof LogEmailProvider)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No disponible.' });
    }

    const last = this.email.lastEmail();
    if (!last) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No se envió ningún correo.' });
    }
    return last;
  }

  @Public()
  @Get('push-deliveries/:liveSessionId')
  async deliveries(
    @Param('liveSessionId') liveSessionId: string,
    @Headers('x-e2e-reset') token?: string,
  ): Promise<{ count: number }> {
    this.assertAllowed(token);
    return {
      count: await this.pushDeliveries.countFor(asLiveSessionId(liveSessionId), 'live_started'),
    };
  }

  private assertAllowed(token?: string): void {
    const expected = this.env.E2E_RESET_TOKEN ?? '';
    const given = token ?? '';
    const ok =
      expected.length > 0 &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) throw new ForbiddenException();
  }
}

@Module({})
export class TestingModule {
  /**
   * Devuelve el módulo solo cuando las tres condiciones se cumplen.
   *
   * Un `DynamicModule` vacío es la forma de decir "esta ruta no existe": no se
   * registra el controlador, así que no hay nada que proteger con un guard ni
   * nada que alguien pueda alcanzar por error.
   */
  static register(env: AppEnv): DynamicModule {
    const enabled =
      env.NODE_ENV === 'test' && env.DATA_DRIVER === 'memory' && Boolean(env.E2E_RESET_TOKEN);

    return enabled
      ? {
          module: TestingModule,
          // `ApplicationModule` trae `PaymentService`, que es quien sabe barrer
          // reservas. Importarlo acá y no duplicar el servicio es lo que hace
          // que la prueba corra por el mismo camino que producción.
          imports: [ApplicationModule],
          controllers: [TestingController],
        }
      : { module: TestingModule };
  }
}
