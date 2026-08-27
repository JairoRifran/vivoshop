import { DomainError } from '../errors';
import type { UserId } from '../value-objects/identifiers';

/**
 * Para qué se sube una imagen.
 *
 * El propósito no es una etiqueta: decide el tamaño máximo, la forma que se le
 * pide a quien recorta, y —lo más importante— forma parte de la clave del
 * archivo. Un logo no puede terminar guardado donde va una portada.
 */
export const UPLOAD_PURPOSES = ['avatar', 'store_logo', 'store_cover'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * Los formatos que se aceptan, y el que se excluye a propósito.
 *
 * **SVG no está, y no es un olvido.** Un SVG es un documento que puede llevar
 * `<script>`, y servido desde nuestro dominio se ejecuta con nuestros permisos:
 * es una vía directa a la sesión de quien mire el perfil. Ningún vendedor
 * necesita un logo vectorial lo suficiente como para pagar eso.
 *
 * AVIF tampoco, por ahora: lo sube poca gente y lo decodifica menos.
 */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

const EXTENSIONS: Record<ImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Cuánto puede pesar cada cosa, ya redimensionada en el navegador.
 *
 * Los límites son generosos respecto de lo que produce el navegador después de
 * bajar la imagen —una portada de 1600px ronda los 300 KB— y ajustados
 * respecto de lo que sale de la cámara de un teléfono, que son 8 a 12 MB. Ese
 * margen es deliberado: si alguien manda el original, algo se saltó el
 * redimensionado y conviene enterarse acá y no en la factura del ancho de banda.
 */
export const MAX_UPLOAD_BYTES: Record<UploadPurpose, number> = {
  avatar: 2 * 1024 * 1024,
  store_logo: 2 * 1024 * 1024,
  store_cover: 4 * 1024 * 1024,
};

/**
 * La forma que se le pide a quien recorta.
 *
 * Sin esto la gente sube fotos verticales de portada y la tienda se ve rota. El
 * recorte ocurre en el navegador; acá vive el número para que la pantalla y
 * cualquier validación futura no lo repitan cada una por su lado.
 */
export const ASPECT_RATIO: Record<UploadPurpose, number> = {
  avatar: 1,
  store_logo: 1,
  store_cover: 16 / 6,
};

/** El lado mayor al que el navegador reduce antes de subir. */
export const MAX_IMAGE_EDGE: Record<UploadPurpose, number> = {
  avatar: 512,
  store_logo: 512,
  store_cover: 1600,
};

export function isImageContentType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Dónde se guarda un archivo.
 *
 * ```
 * store_cover/usr_a1b2.../f3d9e1c8.webp
 * └─ propósito  └─ dueño   └─ nombre irrepetible
 * ```
 *
 * **El dueño va en la ruta, y esa es la regla de seguridad de todo esto.**
 * Cuando alguien termina de subir, el navegador nos manda la clave —no una URL—
 * y el servidor comprueba que el segmento del dueño sea quien está en sesión.
 * Sin eso, cualquiera podría mandar la clave de otro, o una URL arbitraria de
 * internet, y quedarse con la foto ajena como logo propio.
 *
 * Que el nombre sea irrepetible evita lo otro: adivinar la clave de alguien.
 */
export function buildMediaKey(input: {
  purpose: UploadPurpose;
  ownerId: UserId;
  fileId: string;
  contentType: ImageContentType;
}): string {
  return `${input.purpose}/${String(input.ownerId)}/${input.fileId}.${EXTENSIONS[input.contentType]}`;
}

const KEY_PATTERN = /^([a-z_]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.(jpg|png|webp)$/;

export interface ParsedMediaKey {
  readonly purpose: UploadPurpose;
  readonly ownerId: string;
}

/** Lee una clave, o `null` si no tiene la forma que emitimos. */
export function parseMediaKey(key: string): ParsedMediaKey | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;

  const [, purpose, ownerId] = match;
  if (!(UPLOAD_PURPOSES as readonly string[]).includes(purpose ?? '')) return null;

  return { purpose: purpose as UploadPurpose, ownerId: ownerId ?? '' };
}

/**
 * Comprueba que una clave sea nuestra, de este dueño y de este propósito.
 *
 * Se llama **siempre** antes de guardar una imagen en un perfil o una tienda.
 * Es lo único que separa "subí mi foto" de "puse la URL que se me ocurrió en el
 * avatar", que hoy es posible porque el campo acepta cualquier cadena.
 */
export function assertOwnMediaKey(input: {
  key: string;
  ownerId: UserId;
  purpose: UploadPurpose;
}): void {
  const parsed = parseMediaKey(input.key);

  if (!parsed || parsed.purpose !== input.purpose) {
    throw new DomainError('INVALID_MEDIA_KEY', 'Esa imagen no es válida.', {
      purpose: input.purpose,
    });
  }
  if (parsed.ownerId !== String(input.ownerId)) {
    // Mismo error a propósito: distinguir "no existe" de "no es tuya" le diría
    // a quien prueba claves ajenas cuáles existen.
    throw new DomainError('INVALID_MEDIA_KEY', 'Esa imagen no es válida.', {
      purpose: input.purpose,
    });
  }
}
