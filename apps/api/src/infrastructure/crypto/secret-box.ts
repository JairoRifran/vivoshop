import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * Cifrado en reposo para credenciales de terceros.
 *
 * Lo que protege: los tokens OAuth del vendedor. Con un access token de Mercado
 * Pago se puede cobrar y devolver en su nombre, así que una copia de la base
 * —un backup extraviado, un dump de soporte, un `SELECT` de más— no puede
 * alcanzar para eso.
 *
 * ## Por qué AES-256-GCM y nada inventado
 *
 * GCM es cifrado **autenticado**: además de ocultar el contenido, detecta si
 * alguien lo modificó. Sin autenticación, quien pueda escribir en la base puede
 * alterar el texto cifrado y hacer que descifre a otra cosa. Node lo trae en
 * `node:crypto`; no hay una línea de criptografía escrita acá, solo el armado
 * del sobre.
 *
 * ## El sobre
 *
 * ```
 * v1.<keyId>.<base64url(iv ‖ tag ‖ ciphertext)>
 * ```
 *
 * - **`v1`** para poder cambiar el esquema sin adivinar qué es cada valor.
 * - **`keyId`** son los primeros 8 hex del SHA-256 de la clave. No revela nada
 *   —es un hash de una clave de 256 bits— y es lo que hace posible **rotar**:
 *   al descifrar se sabe cuál de las claves configuradas usar, en vez de
 *   probarlas todas o migrar todo de golpe.
 * - **`iv`** de 12 bytes, aleatorio por operación. Reusar un IV con la misma
 *   clave en GCM es catastrófico, así que nunca se deriva de nada.
 *
 * ## El contexto
 *
 * Cada valor se cifra ligado a dónde vive (`seller_payment_accounts.access_token`).
 * GCM lo verifica como dato asociado, así que un texto cifrado de una columna
 * no descifra en otra: nadie puede mover el refresh token a la columna del
 * access token y hacer que el sistema lo use como tal.
 */
export interface SecretBox {
  /** Cifra, ligando el resultado a `context`. `null` entra y sale igual. */
  seal(plain: string | null, context: string): string | null;
  /** Descifra lo que produjo `seal` con el mismo `context`. */
  open(sealed: string | null, context: string): string | null;
}

export const SECRET_BOX = Symbol('SECRET_BOX');

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * La clave de desarrollo.
 *
 * Existe para que el camino de cifrado se ejecute igual en las pruebas y en la
 * máquina de quien programa. La alternativa —no cifrar cuando falta la clave—
 * deja el código de producción sin ejercitar hasta que se despliega, que es
 * cuando peor se descubre un error.
 *
 * No protege nada y no pretende hacerlo: está escrita acá, en un repositorio
 * público. En producción falta la clave y el proceso no arranca.
 */
const DEVELOPMENT_KEY = createHash('sha256').update('vivoshop-development-only').digest();

function keyIdOf(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function decodeKey(value: string, name: string): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${name} debe ser 32 bytes en base64 (son ${key.length}). ` +
        'Generá una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return key;
}

/**
 * Resuelve las claves desde el entorno.
 *
 * `ENCRYPTION_KEY` cifra y descifra; `ENCRYPTION_KEY_PREVIOUS` **solo**
 * descifra. Esa asimetría es toda la rotación: se pone la nueva como actual y
 * la vieja como anterior, y el sistema sigue leyendo lo que ya estaba escrito
 * mientras lo nuevo se escribe con la nueva. Sin ventana de indisponibilidad y
 * sin migrar todo de golpe.
 */
export function loadEncryptionKeys(source: {
  ENCRYPTION_KEY?: string | undefined;
  ENCRYPTION_KEY_PREVIOUS?: string | undefined;
  isProduction: boolean;
}): { current: Buffer; accepted: Buffer[] } {
  const configured = source.ENCRYPTION_KEY?.trim();

  if (!configured) {
    if (source.isProduction) {
      // Explícito y accionable: arrancar sin clave significaría escribir los
      // tokens en claro, que es exactamente lo que esto viene a impedir.
      throw new Error(
        'Falta ENCRYPTION_KEY. Sin ella los tokens de los vendedores quedarían en texto plano. ' +
          'Generá una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    return { current: DEVELOPMENT_KEY, accepted: [DEVELOPMENT_KEY] };
  }

  const current = decodeKey(configured, 'ENCRYPTION_KEY');
  const previous = source.ENCRYPTION_KEY_PREVIOUS?.trim();
  const accepted = previous
    ? [current, decodeKey(previous, 'ENCRYPTION_KEY_PREVIOUS')]
    : [current];

  return { current, accepted };
}

export class AesGcmSecretBox implements SecretBox {
  private readonly logger = new Logger(AesGcmSecretBox.name);
  private readonly current: Buffer;
  private readonly currentId: string;
  private readonly byId: Map<string, Buffer>;
  private warnedAboutPlaintext = false;

  constructor(keys: { current: Buffer; accepted: Buffer[] }) {
    this.current = keys.current;
    this.currentId = keyIdOf(keys.current);
    this.byId = new Map(keys.accepted.map((key) => [keyIdOf(key), key]));
  }

  seal(plain: string | null, context: string): string | null {
    if (plain === null || plain === '') return plain;

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.current, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

    return `${VERSION}.${this.currentId}.${payload.toString('base64url')}`;
  }

  open(sealed: string | null, context: string): string | null {
    if (sealed === null || sealed === '') return sealed;

    const parts = sealed.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) {
      /**
       * Un valor sin sobre es de antes de que esto existiera.
       *
       * Se devuelve tal cual para no romper una tienda ya conectada, y se avisa
       * una sola vez por proceso: repetirlo en cada lectura ahogaría el log
       * justo cuando hay que leerlo. Deja de aparecer cuando corre la
       * migración —`encrypt-tokens.ts`—, y esa desaparición es la señal de que
       * ya no queda nada en claro.
       */
      if (!this.warnedAboutPlaintext) {
        this.warnedAboutPlaintext = true;
        this.logger.warn(
          `Hay credenciales sin cifrar en ${context}. Corré la migración de cifrado.`,
        );
      }
      return sealed;
    }

    const [, keyId, encoded] = parts;
    const key = this.byId.get(keyId ?? '');
    if (!key) {
      // Nunca el valor, ni un pedazo: solo qué clave haría falta.
      throw new Error(
        `No hay clave de descifrado ${keyId} configurada. ` +
          'Si rotaste ENCRYPTION_KEY, la anterior va en ENCRYPTION_KEY_PREVIOUS.',
      );
    }

    const payload = Buffer.from(encoded ?? '', 'base64url');
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);

    // `final()` tira si el tag no verifica: contenido alterado, contexto
    // equivocado o clave que no corresponde. No se atrapa a propósito — seguir
    // con un valor que no se pudo autenticar es peor que fallar.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

/**
 * Una caja con la clave de desarrollo, para pruebas y utilitarios.
 *
 * Se usa donde no hay contenedor de inyección —el smoke de drizzle, el arnés de
 * drivers— y ejercita el mismo camino que producción: los tokens se cifran y
 * se descifran de verdad, solo que con una clave que no protege nada.
 */
export function developmentSecretBox(): SecretBox {
  return new AesGcmSecretBox(loadEncryptionKeys({ isProduction: false }));
}

/** Dónde vive cada secreto. Ver el comentario sobre el contexto, arriba. */
export const SECRET_CONTEXT = {
  accessToken: 'seller_payment_accounts.access_token',
  refreshToken: 'seller_payment_accounts.refresh_token',
} as const;
