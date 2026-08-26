import { Inject, Injectable, Logger } from '@nestjs/common';
import { isPushSubscriptionGone, type UserId } from '@vivo/domain';
import webpush from 'web-push';
import type {
  Clock,
  NotificationChannel,
  NotificationProvider,
} from '../../application/ports/infrastructure';
import type { PushSubscriptionRepository } from '../../application/ports/repositories';
import { CLOCK, PUSH_SUBSCRIPTION_REPOSITORY } from '../../application/ports/tokens';
import { ENV, type AppEnv } from '../../config/env';

/**
 * Avisos por Web Push.
 *
 * ## Por qué Web Push y no una app
 *
 * VivoShop ya es una PWA instalable. Web Push funciona con eso: sin tienda de
 * aplicaciones, sin revisión, sin dos binarios que mantener. Para un producto
 * que todavía tiene que demostrar que a alguien le importa, el costo de entrada
 * correcto es cero.
 *
 * ## Lo que hace este adaptador y lo que no
 *
 * Traduce "avisale a estas personas" a "mandá este mensaje a estos navegadores".
 * No decide **cuándo** avisar —eso vive en el dominio— ni **qué** decir. Igual
 * que el adaptador de Mercado Pago no decide cuánta comisión cobrar.
 *
 * ## La baja limpia
 *
 * Un endpoint que devuelve 404 o 410 no vuelve nunca: el navegador se
 * desinstaló, la persona revocó el permiso, o la URL rotó. Se borra en el acto.
 * Sin eso la tabla acumula destinos muertos y cada vivo gasta envíos en gente
 * que ya no está — y peor, las métricas de entrega mienten hacia arriba.
 *
 * El resto de los errores son transitorios y no borran nada.
 *
 * ## Un envío que falla no puede voltear un vivo
 *
 * `notify` nunca tira. Si el servicio de push está caído, el vivo empieza
 * igual; lo que se pierde es un aviso, no una transmisión. Por eso cada envío
 * va con su propio `catch` y el resultado se resume en una línea de log.
 */
@Injectable()
export class WebPushNotificationProvider implements NotificationProvider {
  readonly key = 'webpush';

  private readonly logger = new Logger(WebPushNotificationProvider.name);

  constructor(
    @Inject(ENV) env: AppEnv,
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: PushSubscriptionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY ?? '',
      env.VAPID_PRIVATE_KEY ?? '',
    );
  }

  async notify(input: {
    userIds: readonly UserId[];
    channel: NotificationChannel;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    // Este adaptador solo sabe de push. Pedirle un email no es un error del
    // llamador: es que todavía no existe el adaptador que corresponde.
    if (input.channel !== 'push') {
      this.logger.log(`Canal "${input.channel}" sin adaptador; no se envió nada.`);
      return;
    }

    const targets = await this.subscriptions.listForUsers(input.userIds);
    if (targets.length === 0) return;

    const payload = JSON.stringify({
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    });

    const gone: string[] = [];
    const delivered: string[] = [];

    // En paralelo: son cientos de envíos independientes y en serie el último
    // llegaría cuando el vivo ya empezó. `allSettled` porque el fallo de uno no
    // puede detener a los demás.
    await Promise.allSettled(
      targets.map(async (target) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: target.endpoint,
              keys: { p256dh: target.p256dh, auth: target.auth },
            },
            payload,
            // El aviso de un vivo pierde sentido cuando el vivo terminó. Media
            // hora es más que suficiente y evita que alguien prenda el teléfono
            // al otro día con la notificación de algo que ya no está.
            { TTL: 30 * 60, urgency: 'high' },
          );
          delivered.push(target.endpoint);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode ?? 0;
          if (isPushSubscriptionGone(status)) {
            gone.push(target.endpoint);
            return;
          }
          // Ni el endpoint ni las claves: un log no es lugar para el destino de
          // los avisos de una persona.
          this.logger.warn(`Envío rechazado por el servicio de push (${status}).`);
        }
      }),
    );

    const now = this.clock.now();
    await Promise.allSettled([
      this.subscriptions.removeMany(gone),
      this.subscriptions.markNotified(delivered, now),
    ]);

    this.logger.log(
      `"${input.title}" → ${delivered.length}/${targets.length} entregados` +
        (gone.length > 0 ? `, ${gone.length} suscripciones dadas de baja` : ''),
    );
  }
}
