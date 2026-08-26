import { Body, Controller, Delete, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { trimUserAgent, type PushSubscription } from '@vivo/domain';
import { z } from 'zod';
import { Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';
import { ENV, type AppEnv } from '../config/env';
import { CLOCK, PUSH_SUBSCRIPTION_REPOSITORY } from '../application/ports/tokens';
import type { Clock } from '../application/ports/infrastructure';
import type { PushSubscriptionRepository } from '../application/ports/repositories';

/**
 * Lo que el navegador necesita para recibir avisos, y para dejar de recibirlos.
 *
 * Tres rutas y ninguna decide nada de producto: guardar un destino, borrarlo, y
 * entregar la clave pública. Cuándo se avisa y a quién lo decide el dominio.
 */
const subscriptionSchema = z.object({
  /** La URL del servicio de push. Es la identidad de la suscripción. */
  endpoint: z.string().url().max(2_000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2_000) });

@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: PushSubscriptionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * La clave pública VAPID.
   *
   * Es pública de verdad, no "pública pero no la mires": el navegador la
   * necesita para suscribirse y viaja al cliente por diseño. Se sirve desde acá
   * en vez de incrustarla en el build del frontend para que rotarla no exija
   * recompilar y redesplegar la web.
   *
   * `null` cuando el proveedor es `log`: el frontend lo lee como "acá no hay
   * avisos" y no le pide permiso a nadie. Pedir permiso para algo que no se va
   * a usar es la forma más rápida de perderlo para siempre.
   */
  @Public()
  @Get('public-key')
  publicKey(): { publicKey: string | null } {
    return {
      publicKey:
        this.env.NOTIFICATION_PROVIDER === 'webpush' ? (this.env.VAPID_PUBLIC_KEY ?? null) : null,
    };
  }

  /**
   * Registra —o actualiza— el navegador de quien está en sesión.
   *
   * Es idempotente por construcción: la identidad es el `endpoint`, así que
   * suscribirse dos veces desde el mismo navegador actualiza una fila en vez de
   * crear dos. Sin eso, cada visita sumaría un destino más y un vivo mandaría
   * el mismo aviso varias veces al mismo teléfono.
   */
  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(subscriptionSchema)) body: z.infer<typeof subscriptionSchema>,
  ): Promise<void> {
    const subscription: PushSubscription = {
      endpoint: body.endpoint,
      userId: requireUser(user).id,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: trimUserAgent(body.userAgent),
      createdAt: this.clock.now(),
      lastNotifiedAt: null,
    };

    await this.subscriptions.save(subscription);
  }

  /**
   * Da de baja un destino.
   *
   * No comprueba de quién es, y es deliberado: quien conoce un endpoint es el
   * navegador dueño de ese endpoint —no se publica en ningún lado— y lo único
   * que se puede lograr con él es dejar de recibir avisos. Exigir que coincida
   * con la sesión rompería el caso que más importa: alguien que revoca el
   * permiso desde el navegador y ya no tiene sesión con qué pedir la baja.
   */
  @Public()
  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @Body(zodPipe(unsubscribeSchema)) body: z.infer<typeof unsubscribeSchema>,
  ): Promise<void> {
    await this.subscriptions.remove(body.endpoint);
  }
}
