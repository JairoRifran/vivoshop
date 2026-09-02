import { DomainError } from '../errors';
import type { UserId } from '../value-objects/identifiers';

/**
 * Por dónde puede entrar alguien.
 *
 * `password` no está en la lista y es a propósito: no es una identidad
 * federada, es una columna de `users`. Esta lista es de terceros que afirman
 * quién sos, y cada uno merece que decidamos por separado cuánto le creemos.
 */
export const AUTH_PROVIDERS = ['google', 'meta'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * Una forma de entrar a una cuenta.
 *
 * Una persona, muchas identidades: la misma cuenta se abre con contraseña, con
 * Google, o con las dos. Es la misma decisión que los roles —aditivos, nunca
 * excluyentes— y por el mismo motivo: nadie debería terminar con dos cuentas
 * en VivoShop porque un día tocó otro botón.
 */
export interface UserIdentity {
  readonly provider: AuthProvider;
  /**
   * El identificador que usa el proveedor, estable para siempre.
   *
   * Es `sub` en Google. **No es el email**, y esa distinción es la que sostiene
   * todo: alguien puede cambiar su email en Google y sigue siendo la misma
   * persona; y un email liberado puede terminar en manos de otra. Lo que
   * identifica es el `sub`.
   */
  readonly providerUserId: string;
  readonly userId: UserId;
  /** Lo que el proveedor dijo al vincular. Se guarda para poder auditar. */
  readonly email: string | null;
  readonly createdAt: Date;
}

/** Lo que devuelve un proveedor cuando termina de autenticar a alguien. */
export interface ProviderProfile {
  readonly providerUserId: string;
  readonly email: string | null;
  /**
   * Si el proveedor **verificó** ese email, no si lo tiene cargado.
   *
   * Es el campo del que cuelga la seguridad de todo esto. Ver
   * `resolveIdentityOutcome`.
   */
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/**
 * Qué hacer cuando alguien vuelve del proveedor.
 *
 * ```
 * ¿ya existe esta identidad?  ── sí ──► `sign_in`
 *          │ no
 *          ▼
 * ¿hay una cuenta con ese email?
 *          │
 *    no ───┴─── sí
 *     │          │
 *     ▼          ▼
 * `register`   ¿el proveedor verificó el email?
 *                   sí ──► `link`
 *                   no ──► `needs_password`
 * ```
 */
export type IdentityOutcome =
  /** La identidad ya estaba: es entrar, sin más. */
  | { readonly kind: 'sign_in'; readonly userId: UserId }
  /** Hay una cuenta con ese email y el proveedor lo verificó: se vinculan. */
  | { readonly kind: 'link'; readonly userId: UserId }
  /** Nadie con ese email: cuenta nueva. */
  | { readonly kind: 'register' }
  /**
   * Hay una cuenta con ese email pero el proveedor **no** lo verificó.
   *
   * No se vincula y no se crea nada: se le pide la contraseña de la cuenta que
   * ya tiene. Es el único desenlace incómodo de los cuatro, y existe para que
   * el resto pueda ser cómodo sin ser peligroso.
   */
  | { readonly kind: 'needs_password'; readonly email: string };

/**
 * La decisión que hace que esto sea confiable o un agujero.
 *
 * ## Por qué no se vincula por email a secas
 *
 * Vincular por email es lo que todo el mundo espera: entro con Google, es mi
 * email, es mi cuenta. El problema es que "es mi email" lo está afirmando un
 * tercero, y no todos los terceros lo comprueban. Si un proveedor deja que
 * alguien registre `ana@vivo.uy` sin probar que puede leer ese buzón, entonces
 * "Ingresar con ese proveedor" se convierte en **el formulario de toma de la
 * cuenta de Ana** — con sus pedidos, su tienda y su cuenta de cobros colgando.
 *
 * No es hipotético: es la forma clásica de robar cuentas en aplicaciones que
 * agregan login social sobre un padrón que ya existe.
 *
 * Google afirma `email_verified` y lo cumple. Meta es más flojo. Así que la
 * regla no es "confío en Google y no en Meta" —eso envejecería mal— sino
 * **confío en lo que el proveedor jura haber verificado, y en nada más**.
 *
 * ## Por qué el desenlace incómodo es el correcto
 *
 * Cuando el email no viene verificado y ya existe una cuenta, lo que queda es
 * pedir la contraseña. Es un paso más para alguien que probablemente sea el
 * dueño legítimo. Pero la alternativa es regalarle la cuenta a quien no lo sea,
 * y el costo no es simétrico: una molestia contra una cuenta perdida.
 *
 * Crear una segunda cuenta con el mismo email tampoco sirve: quedan dos
 * personas donde hay una, con la mitad de los pedidos en cada una.
 */
export function resolveIdentityOutcome(input: {
  readonly profile: ProviderProfile;
  /** La identidad, si esta cuenta del proveedor ya estaba vinculada. */
  readonly existingIdentity: UserIdentity | null;
  /** El id del usuario que ya usa ese email, si hay alguno. */
  readonly userIdForEmail: UserId | null;
}): IdentityOutcome {
  // Primero la identidad, siempre. Alguien que cambió su email en Google sigue
  // siendo el mismo `sub`, y buscar por email antes lo trataría como otra
  // persona.
  if (input.existingIdentity) {
    return { kind: 'sign_in', userId: input.existingIdentity.userId };
  }

  const email = input.profile.email;
  // Sin email no hay a quién vincular ni con qué registrar. Pasa cuando alguien
  // revoca el permiso de email en el proveedor.
  if (!email) {
    throw new DomainError('IDENTITY_EMAIL_REQUIRED', 'El proveedor no compartió un email.', {
      provider: 'unknown',
    });
  }

  if (!input.userIdForEmail) {
    // Nadie usa ese email. Que el proveedor lo haya verificado o no da igual
    // acá: no hay ninguna cuenta ajena que tomar.
    return { kind: 'register' };
  }

  return input.profile.emailVerified
    ? { kind: 'link', userId: input.userIdForEmail }
    : { kind: 'needs_password', email };
}

/**
 * A dónde se vuelve después de entrar.
 *
 * Solo rutas de nuestro sitio. Un `?next=https://sitio-falso.uy` convertiría
 * nuestro login en un trampolín: el enlace sale de nuestro dominio —con nuestro
 * candado y nuestro nombre— y termina en una pantalla que pide la contraseña
 * otra vez. Es de las cosas que más rinde en un phishing.
 *
 * `//host` y `/\host` también se rechazan: el navegador los lee como absolutos
 * aunque empiecen con barra.
 */
export function safeReturnPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
