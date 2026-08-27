import { Inject, Injectable, Logger } from '@nestjs/common';
import { isPushSubscriptionGone } from '@vivo/domain';
import webpush from 'web-push';

/** Cuántos envíos van a la vez. Ver el comentario en `send`. */
const BATCH_SIZE = 50;
import type {
  NotificationProvider,
  PushMessage,
  PushTarget,
} from '../../application/ports/infrastructure';
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

  constructor(@Inject(ENV) env: AppEnv) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY ?? '',
      env.VAPID_PRIVATE_KEY ?? '',
    );
  }

  async send(input: {
    targets: readonly PushTarget[];
    message: PushMessage;
  }): Promise<{ delivered: readonly string[]; gone: readonly string[] }> {
    if (input.targets.length === 0) return { delivered: [], gone: [] };

    const payload = JSON.stringify(input.message);
    const gone: string[] = [];
    const delivered: string[] = [];

    /**
     * En tandas, no todos de golpe ni uno detrás de otro.
     *
     * Secuencial, el último aviso llegaría cuando el vivo ya empezó. Todos a la
     * vez, mil envíos abrirían mil conexiones desde el proceso que en ese mismo
     * momento está abriendo una transmisión. La tanda acota las dos cosas.
     *
     * El límite real de este diseño está en el comentario de la clase: con
     * muchos miles de seguidores esto tiene que salir del proceso y pasar a una
     * cola. Hoy no hace falta, y se dice para que se note cuándo empieza a
     * hacer falta.
     */
    for (let start = 0; start < input.targets.length; start += BATCH_SIZE) {
      const batch = input.targets.slice(start, start + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (target) => {
          try {
            await webpush.sendNotification(
              { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
              payload,
              // El aviso de un vivo pierde sentido cuando el vivo terminó. Media
              // hora evita que alguien prenda el teléfono al otro día con la
              // notificación de algo que ya no está.
              { TTL: 30 * 60, urgency: 'high' },
            );
            delivered.push(target.endpoint);
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode ?? 0;
            if (isPushSubscriptionGone(status)) {
              gone.push(target.endpoint);
              return;
            }
            // Ni el endpoint ni las claves: un log no es lugar para el destino
            // de los avisos de una persona.
            this.logger.warn(`Envío rechazado por el servicio de push (${status}).`);
          }
        }),
      );
    }

    return { delivered, gone };
  }
}
