import type { UserId } from '../value-objects/identifiers';

/**
 * Un navegador que aceptó recibir avisos.
 *
 * ## Por qué la identidad es el `endpoint`
 *
 * El navegador entrega una URL a la que el servidor de push del fabricante
 * —Google, Mozilla, Apple— reenvía el mensaje. Esa URL **es** la suscripción:
 * si la misma persona vuelve a suscribirse desde el mismo navegador obtiene la
 * misma, y si el navegador la rota la vieja deja de existir. Darle un id
 * propio agregaría una identidad que no manda sobre nada y abriría la puerta a
 * tener dos filas para el mismo destino, que en la práctica significa mandar el
 * aviso dos veces.
 *
 * Una persona tiene tantas suscripciones como navegadores use. Eso es correcto
 * y buscado: quien mira el vivo en el teléfono y compra en la computadora tiene
 * que enterarse en los dos.
 *
 * ## Lo que NO se guarda
 *
 * `p256dh` y `auth` son las claves con las que el navegador descifra el
 * mensaje. Son de ese navegador y no sirven para nada más —no identifican a la
 * persona, no dan acceso a nada— pero igual se tratan como el resto: no salen
 * en ningún DTO y no se loguean.
 */
export interface PushSubscription {
  /** La URL del servicio de push. Es la clave primaria. */
  readonly endpoint: string;
  readonly userId: UserId;
  /** Clave pública del navegador, para cifrar el mensaje. */
  readonly p256dh: string;
  /** Secreto de autenticación del navegador. */
  readonly auth: string;
  /**
   * Con qué se suscribió, recortado.
   *
   * Solo para que alguien pueda entender una lista de dispositivos en soporte
   * —"Chrome en Android"— sin tener que descifrar una URL opaca. Nunca se usa
   * para decidir nada.
   */
  readonly userAgent: string | null;
  readonly createdAt: Date;
  /** Última vez que el servicio de push aceptó un envío a este endpoint. */
  readonly lastNotifiedAt: Date | null;
}

/**
 * Si el servicio de push dice que esta suscripción ya no existe.
 *
 * `404` y `410` son definitivos: el navegador se desinstaló, la persona revocó
 * el permiso, o el endpoint rotó. La suscripción se borra, y esa es la baja
 * limpia — sin esto la tabla acumula destinos muertos para siempre y cada vivo
 * gasta envíos en gente que ya no está.
 *
 * Cualquier otro código es transitorio: un `429` o un `503` son el servicio de
 * push teniendo un mal momento, y borrar por eso sería desuscribir a alguien
 * que no hizo nada.
 */
export function isPushSubscriptionGone(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

/**
 * Cuánto texto de `userAgent` se guarda.
 *
 * Suficiente para reconocer el navegador y el sistema; no tanto como para que
 * la columna se vuelva un registro de qué usa cada persona.
 */
export const USER_AGENT_MAX_LENGTH = 120;

export function trimUserAgent(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, USER_AGENT_MAX_LENGTH);
}
