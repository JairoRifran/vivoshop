import { DomainError } from '../errors';
import type { OrderStatus } from './order';
import type { UserId } from '../value-objects/identifiers';

/**
 * Borrar la cuenta.
 *
 * ## Por qué esto no es un `DELETE`
 *
 * `orders.buyer_id`, `payments.payer_id` y `bids.buyer_id` referencian al
 * usuario con `onDelete: 'restrict'`. La base **se niega** a borrar a alguien
 * que compró algo, y hace bien: del otro lado de cada pedido hay un vendedor
 * con una obligación contable, y del otro lado de cada venta hay un comprador
 * con derecho a su historial.
 *
 * Así que borrar una cuenta es **anonimizarla**: se va todo lo que identifica a
 * la persona y queda el esqueleto de las operaciones, atado a un identificador
 * que ya no apunta a nadie.
 *
 * Eso es lo que dice `/eliminar-cuenta`, y es lo que hace el código.
 */

/** Lo que se ve en lugar del nombre de quien se fue. */
export const DELETED_ACCOUNT_NAME = 'Cuenta eliminada';

/**
 * El correo que reemplaza al real.
 *
 * Tiene que ser **único** —la columna lo exige— y **no entregable**, para que
 * un error de programación no le mande un correo a nadie. `.invalid` está
 * reservado por el RFC 2606 justamente para esto: ningún servidor lo resuelve.
 *
 * Y libera el correo original, así que la persona puede volver a registrarse
 * mañana con la misma dirección y empezar de cero. Un borrado que te deja el
 * email tomado para siempre no es un borrado.
 */
export function anonymizedEmailFor(userId: UserId): string {
  return `cuenta-eliminada+${userId}@vivoshop.invalid`;
}

/**
 * Un pedido “en vuelo” es uno donde todavía hay plata o mercadería moviéndose.
 *
 * `delivered` cuenta como en vuelo a propósito: la Ley N.º 17.250 le da al
 * comprador cinco días para arrepentirse **después de recibir**, y durante esa
 * ventana el vendedor tiene que seguir siendo alguien a quien reclamarle.
 */
const TERMINALES: readonly OrderStatus[] = ['completed', 'cancelled'];

export function isOrderInFlight(status: OrderStatus): boolean {
  return !TERMINALES.includes(status);
}

export interface AccountDeletionCheck {
  /** Pedidos sin cerrar donde esta persona es quien compró. */
  readonly comoComprador: number;
  /** Pedidos sin cerrar sobre la tienda de esta persona. */
  readonly comoVendedor: number;
}

/**
 * Se puede borrar la cuenta salvo que quede algo sin terminar.
 *
 * No es una traba burocrática. Si alguien se borra con un pedido pagado y sin
 * entregar, del otro lado queda una persona que pagó y no tiene a quién
 * reclamarle. El borrado no puede ser una salida de emergencia para eso.
 *
 * Los dos lados se comprueban por separado porque el mensaje tiene que decir
 * cuál es: “tenés una compra en curso” y “tenés una venta sin entregar” se
 * resuelven de maneras distintas.
 */
export function assertCanDeleteAccount(check: AccountDeletionCheck): void {
  if (check.comoVendedor > 0) {
    throw new DomainError(
      'ACCOUNT_HAS_PENDING_SALES',
      'Hay ventas sin cerrar en la tienda de esta cuenta.',
      { pendientes: check.comoVendedor },
    );
  }

  if (check.comoComprador > 0) {
    throw new DomainError(
      'ACCOUNT_HAS_PENDING_ORDERS',
      'Hay compras sin cerrar en esta cuenta.',
      { pendientes: check.comoComprador },
    );
  }
}

/**
 * La confirmación: escribir el propio correo.
 *
 * Se eligió sobre pedir la contraseña porque **quien entró con Google no tiene
 * ninguna**, y sobre una casilla de tildar porque una casilla se marca sin
 * leer. Escribir el correo obliga a mirar qué cuenta se está borrando, que es
 * exactamente el error que hay que evitar.
 *
 * La comparación ignora mayúsculas y espacios de los bordes: el requisito es
 * demostrar intención, no tipear con precisión.
 */
export function confirmationMatches(input: string, email: string): boolean {
  return input.trim().toLowerCase() === email.trim().toLowerCase();
}

export function assertConfirmationMatches(input: string, email: string): void {
  if (!confirmationMatches(input, email)) {
    throw new DomainError(
      'ACCOUNT_CONFIRMATION_MISMATCH',
      'El texto de confirmación no coincide con el correo de la cuenta.',
      {},
    );
  }
}
