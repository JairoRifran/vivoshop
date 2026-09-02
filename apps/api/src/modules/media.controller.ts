import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { MAX_UPLOAD_BYTES, UPLOAD_PURPOSES, isImageContentType } from '@vivo/domain';
import { z } from 'zod';
import { Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';
import { MediaService, type UploadTargetDto } from '../application/services/media.service';
import { STORAGE_PROVIDER } from '../application/ports/tokens';
import type { StorageProvider } from '../application/ports/infrastructure';
import { LocalStorageProvider } from '../infrastructure/providers/simulated.providers';

const uploadRequestSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.string().max(60),
});

/**
 * Pedir permiso para subir una imagen.
 *
 * Una sola ruta de producto —`POST /media/uploads`— y dos que solo existen con
 * el driver de desarrollo. Ver `MediaService` para por qué los bytes van
 * directo al almacenamiento y no pasan por acá.
 *
 * Todo cuelga de `media/` en vez de estar en la raíz. No es solo prolijidad:
 * `/uploads` a secas es un nombre que los agentes de seguridad de escritorio
 * inspeccionan, y en esta máquina de desarrollo mataba el proceso de Node antes
 * de que la petición llegara al handler. Un prefijo agrupa las rutas y esquiva
 * el problema.
 */
@Controller()
export class MediaController {
  constructor(
    private readonly media: MediaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Devuelve dónde escribir y con qué clave volver.
   *
   * El límite es bajo a propósito: alguien que edita su perfil pide una o dos
   * firmas, no cien. Firmar es barato, pero cada firma es una escritura
   * autorizada en el bucket, y no hay razón para regalar miles.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('media/uploads')
  async createUpload(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(uploadRequestSchema)) body: z.infer<typeof uploadRequestSchema>,
  ): Promise<UploadTargetDto> {
    return this.media.createUploadTarget({
      ownerId: requireUser(user).id,
      purpose: body.purpose,
      contentType: body.contentType,
    });
  }

  /**
   * Recibe los bytes — **solo** con `STORAGE_PROVIDER=local`.
   *
   * Es el sustituto del bucket para desarrollo y para la suite de punta a
   * punta. Con cualquier otro driver devuelve 404, así que no queda como una
   * ruta de escritura abierta esperando a que alguien la encuentre.
   *
   * No pide sesión, y con razón: en Supabase tampoco la habría —lo que
   * autoriza es la URL firmada, que solo tiene quien pidió la firma. Replicar
   * eso acá con una firma de mentira sería fingir una garantía. Lo que la hace
   * segura es que esta ruta no existe fuera de desarrollo.
   */
  @Public()
  @Put('media/dev/upload/:purpose/:owner/:file')
  async devUpload(
    @Param('purpose') purpose: string,
    @Param('owner') owner: string,
    @Param('file') file: string,
    @Headers('content-type') contentType: string | undefined,
    @Req() request: Request,
  ): Promise<void> {
    const local = this.localOrNotFound();
    const type = (contentType ?? '').split(';')[0]?.trim() ?? '';
    if (!isImageContentType(type)) throw new NotFoundException();

    const key = `${purpose}/${owner}/${file}`;
    const limit =
      MAX_UPLOAD_BYTES[purpose as keyof typeof MAX_UPLOAD_BYTES] ?? MAX_UPLOAD_BYTES.avatar;

    local.put(key, type, await readBody(request, limit));
  }

  /** Devuelve los bytes — solo con `STORAGE_PROVIDER=local`. */
  @Public()
  @Get('media/dev/file/:purpose/:owner/:file')
  @Header('Cache-Control', 'public, max-age=60')
  devFile(
    @Param('purpose') purpose: string,
    @Param('owner') owner: string,
    @Param('file') file: string,
    @Res() response: Response,
  ): void {
    const stored = this.localOrNotFound().get(`${purpose}/${owner}/${file}`);
    if (!stored) throw new NotFoundException();

    // El tipo con el que se guardó, nunca uno que venga de la petición: servir
    // bytes ajenos con un `Content-Type` elegido por quien los pide es cómo una
    // imagen se convierte en un script.
    response.setHeader('Content-Type', stored.contentType);
    response.send(stored.bytes);
  }

  private localOrNotFound(): LocalStorageProvider {
    if (!(this.storage instanceof LocalStorageProvider)) throw new NotFoundException();
    return this.storage;
  }
}

/**
 * Lee el cuerpo cortando en cuanto se pasa del límite.
 *
 * Cortar mientras llega —y no después— es la diferencia entre rechazar una
 * subida de 2 GB y quedarse sin memoria por ella.
 */
async function readBody(request: Request, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw new PayloadTooLargeException();
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}
