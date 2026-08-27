import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_UPLOAD_BYTES,
  assertOwnMediaKey,
  buildMediaKey,
  isImageContentType,
  DomainError,
  type UploadPurpose,
  type UserId,
} from '@vivo/domain';
import type { IdGenerator, StorageProvider } from '../ports/infrastructure';
import { ID_GENERATOR, STORAGE_PROVIDER } from '../ports/tokens';

export interface UploadTargetDto {
  /** Dónde escribir los bytes. Autoriza **este** archivo y nada más. */
  readonly uploadUrl: string;
  /** Lo que el navegador nos devuelve al terminar. Nunca una URL. */
  readonly key: string;
  readonly expiresAt: string;
  readonly maxBytes: number;
}

/**
 * Subir una imagen, en dos pasos y con una regla.
 *
 * ```
 * navegador ─1─► POST /uploads          (¿dónde escribo un avatar?)
 *           ◄─── { uploadUrl, key }
 *           ─2─► PUT uploadUrl           bytes, directo al almacenamiento
 *           ─3─► PATCH /auth/me { avatarKey: key }
 * ```
 *
 * Los bytes no pasan por la API: un teléfono con una foto de 3 MB no ocupa un
 * worker de Node durante toda la subida, y el almacenamiento hace lo que sabe
 * hacer. La API solo firma y después acepta —o no— la clave resultante.
 *
 * **La regla es que el dueño va en la clave.** El paso 3 recibe una clave, no
 * una URL, y `assertOwnMediaKey` comprueba que el segmento del dueño sea quien
 * está en sesión. Sin eso, el paso 3 sería "poné acá la URL que quieras": la
 * foto de otra persona, un pixel de rastreo en un servidor ajeno, o una imagen
 * que cambia de contenido después de que alguien la mire.
 *
 * ## Lo que no se valida, y por qué
 *
 * Nadie comprueba que los bytes subidos sean realmente una imagen. Hacerlo
 * exigiría que pasaran por la API —justo lo que este diseño evita— y la
 * protección real es otra: el bucket sirve todo con el `Content-Type` que se
 * firmó, y los tipos que firmamos no ejecutan nada. SVG queda afuera por eso
 * mismo. Ver `IMAGE_CONTENT_TYPES`.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async createUploadTarget(input: {
    ownerId: UserId;
    purpose: UploadPurpose;
    contentType: string;
  }): Promise<UploadTargetDto> {
    if (!isImageContentType(input.contentType)) {
      throw new DomainError('INVALID_MEDIA_KEY', 'Ese formato de imagen no se acepta.', {
        contentType: input.contentType,
      });
    }

    const key = buildMediaKey({
      purpose: input.purpose,
      ownerId: input.ownerId,
      // Irrepetible a propósito: sin esto, la clave de alguien sería adivinable
      // y una subida pisaría la anterior.
      fileId: this.ids.generate(),
      contentType: input.contentType,
    });
    const maxBytes = MAX_UPLOAD_BYTES[input.purpose];
    const target = await this.storage.createUploadTarget({
      key,
      contentType: input.contentType,
      maxBytes,
    });

    return {
      uploadUrl: target.uploadUrl,
      key,
      expiresAt: target.expiresAt.toISOString(),
      maxBytes,
    };
  }

  /**
   * Convierte lo que mandó el navegador en lo que se guarda en la base.
   *
   * Tres casos, y los tres importan: `undefined` es "no toqué la imagen" y
   * conserva la actual, `null` es "sacala", y una clave es una imagen nueva
   * —que tiene que ser de quien está en sesión y del propósito correcto, o no
   * se guarda nada.
   */
  resolve(input: {
    key: string | null | undefined;
    current: string | null;
    ownerId: UserId;
    purpose: UploadPurpose;
  }): string | null {
    if (input.key === undefined) return input.current;
    if (input.key === null) return null;

    assertOwnMediaKey({ key: input.key, ownerId: input.ownerId, purpose: input.purpose });
    return this.storage.publicUrl(input.key);
  }
}
