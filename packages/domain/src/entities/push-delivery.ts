import type { LiveSessionId } from '../value-objects/identifiers';

/**
 * De qué se avisa.
 *
 * M05 tiene uno solo. El tipo existe igual porque es parte de la identidad de
 * un envío: el día que haya "tu pedido salió", ese aviso y el de un vivo tienen
 * que poder convivir para el mismo dispositivo sin que uno bloquee al otro.
 */
export const PUSH_DELIVERY_TYPES = ['live_started'] as const;
export type PushDeliveryType = (typeof PUSH_DELIVERY_TYPES)[number];

/**
 * La constancia de que un aviso ya se decidió para un dispositivo.
 *
 * ## Por qué no alcanza con que el endpoint sea único
 *
 * Que una suscripción no se duplique impide mandar dos avisos por tener dos
 * filas. No impide mandar dos avisos por **intentarlo dos veces**: el proceso
 * muere después de enviar y antes de anotar, Railway lo reinicia, el barrido
 * reintenta. O dos réplicas anuncian el mismo vivo al mismo tiempo. En los dos
 * casos las suscripciones están perfectamente deduplicadas y el teléfono suena
 * dos veces igual.
 *
 * La garantía tiene que vivir donde sobrevive a un reinicio, y eso es la base:
 * una restricción única sobre `(liveSessionId, endpoint, type)`. Reservar es un
 * insert; si otro ya reservó, el insert no entra y ese dispositivo no se toca.
 * No hay lectura previa que pueda quedar vieja entre el `select` y el `insert`.
 *
 * ## La semántica que se alcanza, dicha con precisión
 *
 * Se reserva **antes** de enviar. Eso significa **como mucho una vez**: si el
 * proceso muere entre la reserva y el envío, ese aviso se pierde y nadie lo
 * reintenta.
 *
 * Es la elección deliberada. Al revés —enviar y después anotar— se conseguiría
 * "al menos una vez", con duplicados garantizados ante cualquier reintento. Web
 * Push no ofrece exactamente-una-vez, así que hay que elegir de qué lado
 * fallar, y para un aviso el costo no es simétrico: perder uno es una venta que
 * alguien no vio; repetirlo es alguien que apaga las notificaciones para
 * siempre.
 */
export interface PushDelivery {
  readonly liveSessionId: LiveSessionId;
  /** El destino. Es la identidad de la suscripción; ver `PushSubscription`. */
  readonly endpoint: string;
  readonly type: PushDeliveryType;
  readonly createdAt: Date;
}
