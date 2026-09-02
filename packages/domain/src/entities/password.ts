import { DomainError } from '../errors';
import type { UserId } from '../value-objects/identifiers';

/**
 * Cuánto vive un enlace para restablecer la contraseña.
 *
 * Una hora. Alcanza de sobra para abrir un email —incluso el que cayó en spam y
 * se encontró un rato después— y es poco para que un enlace olvidado en un
 * buzón ajeno, en una computadora compartida o en el historial de un webmail
 * siga sirviendo.
 */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/**
 * Un permiso para elegir una contraseña nueva.
 *
 * ## Se guarda el hash, nunca el token
 *
 * `tokenHash` y no `token`, y esa es la decisión que importa de toda la tabla.
 * El token viaja por email y vive en el buzón de la persona; nosotros solo
 * guardamos su huella. Si la base se filtra, lo que el atacante encuentra no
 * abre ninguna cuenta: no puede invertir el hash para reconstruir el enlace.
 *
 * Es la misma lógica que guardar contraseñas hasheadas, aplicada a algo que
 * **también** es una credencial —una que además llega por un canal que no
 * controlamos—.
 *
 * A diferencia de una contraseña, acá alcanza con SHA-256: el token son 32
 * bytes aleatorios, no una palabra que alguien eligió, así que no hay nada que
 * adivinar por fuerza bruta ni diccionario contra el que defenderse.
 */
export interface PasswordResetToken {
  readonly tokenHash: string;
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** Se usa una sola vez. Ver `isResetTokenUsable`. */
  readonly consumedAt: Date | null;
}

/**
 * Si un permiso sigue sirviendo.
 *
 * De un solo uso, y por una razón concreta: sin eso, alguien que consigue el
 * enlace —del historial, de un buzón compartido, de una captura— puede volver a
 * cambiar la contraseña después de que su dueño ya la cambió, y quedarse con la
 * cuenta.
 */
export function isResetTokenUsable(
  token: PasswordResetToken,
  now: Date = new Date(),
): boolean {
  return token.consumedAt === null && token.expiresAt.getTime() > now.getTime();
}

/**
 * Si una sesión emitida en `issuedAt` sigue viva.
 *
 * ## Por qué cambiar la contraseña tiene que cerrar las otras sesiones
 *
 * El caso que justifica todo esto: alguien entró a tu cuenta y vos cambiás la
 * contraseña para echarlo. Si sus sesiones siguen abiertas, no lo echaste —
 * sigue adentro hasta que su token venza por su cuenta, que acá son siete días.
 * Un restablecimiento que no cierra sesiones es un teatro de seguridad.
 *
 * Nuestros JWT no se pueden revocar de a uno: son sin estado, y esa es la
 * gracia. Pero sí se puede fechar el corte. Cada sesión lleva su `iat`, y una
 * emitida antes del último cambio de contraseña está muerta.
 *
 * El guard ya carga al usuario en cada petición autenticada para comprobar que
 * siga activo, así que esta comprobación **no cuesta una consulta más**: usa un
 * dato que ya está en la mano.
 *
 * La resolución es de un segundo —es lo que guarda el `iat` de un JWT— así que
 * se compara con el segundo redondeado hacia abajo. Un token emitido en el
 * mismo segundo del cambio sobrevive; es la sesión de quien acaba de cambiarla,
 * que es justamente la que no queremos cerrar.
 */
export function isSessionStillValid(input: {
  /** `iat` del token, en segundos desde epoch. */
  readonly issuedAtSeconds: number;
  readonly passwordChangedAt: Date | null;
}): boolean {
  if (!input.passwordChangedAt) return true;

  const changedAtSeconds = Math.floor(input.passwordChangedAt.getTime() / 1000);
  return input.issuedAtSeconds >= changedAtSeconds;
}

/**
 * Qué se le puede pedir a alguien para cambiar su contraseña.
 *
 * Dos situaciones distintas y la diferencia no es un detalle:
 *
 * - **Ya tiene contraseña.** Se le pide la actual. Sin eso, una sesión robada
 *   —una computadora que quedó abierta, una cookie filtrada— alcanza para
 *   cambiar la contraseña y dejar afuera al dueño de la cuenta.
 *
 * - **No tiene ninguna** porque entró con Google. Pedirle "la actual" sería
 *   pedirle algo que no existe. Se le deja poner una, y no abre un agujero
 *   nuevo: quien tenga esa sesión ya podía usar la cuenta, y ponerle una
 *   contraseña no le quita a nadie su forma de entrar —Google sigue andando—.
 */
export function assertCanChangePassword(input: {
  readonly hasPassword: boolean;
  readonly currentPasswordProvided: boolean;
}): void {
  if (input.hasPassword && !input.currentPasswordProvided) {
    throw new DomainError(
      'CURRENT_PASSWORD_REQUIRED',
      'Ingresá tu contraseña actual para cambiarla.',
      {},
    );
  }
}
