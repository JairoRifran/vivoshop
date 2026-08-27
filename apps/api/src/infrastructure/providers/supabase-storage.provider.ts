import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@vivo/domain';
import type { StorageProvider } from '../../application/ports/infrastructure';
import { ENV, type AppEnv } from '../../config/env';

/**
 * Las imágenes, en Supabase Storage.
 *
 * ## Por qué Supabase y no otro
 *
 * La base ya es Supabase. Eso significa una cuenta menos, una factura menos y
 * un panel menos que aprender — y para un producto que todavía tiene que
 * demostrar que a alguien le importa, cada proveedor nuevo es un costo fijo que
 * no se paga solo. Su API de subidas firmadas tiene además exactamente la forma
 * que el puerto ya tenía desde M01.
 *
 * Si algún día conviene mudarse a R2 o a S3, lo que cambia es este archivo.
 *
 * ## La URL firmada
 *
 * `POST /object/upload/sign/<bucket>/<key>` devuelve un token que autoriza a
 * escribir **ese** archivo y nada más, por un rato. No es una llave del bucket:
 * si se filtra, lo peor que puede pasar es que alguien pise una imagen que de
 * todos modos era suya.
 *
 * El bucket es público de lectura porque un logo se muestra en una grilla, en
 * un vivo y en un resultado de búsqueda: firmar cada lectura sería pagar una
 * consulta por cada miniatura, y no hay nada que proteger — son imágenes que su
 * dueño publicó para que las vean.
 */
@Injectable()
export class SupabaseStorageProvider implements StorageProvider {
  readonly key = 'supabase';

  private readonly logger = new Logger(SupabaseStorageProvider.name);
  private readonly base: string;
  private readonly bucket: string;
  private readonly serviceKey: string;

  constructor(@Inject(ENV) env: AppEnv) {
    // Sin barra final: se concatena en cada URL y `//` rompe algunas rutas de
    // Supabase de formas que solo se ven en producción.
    this.base = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
    this.bucket = env.SUPABASE_STORAGE_BUCKET;
    this.serviceKey = env.SUPABASE_SERVICE_KEY ?? '';
  }

  async createUploadTarget(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<{ uploadUrl: string; expiresAt: Date }> {
    const endpoint = `${this.base}/storage/v1/object/upload/sign/${this.bucket}/${input.key}`;

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'No pudimos preparar la subida.', {
        cause: cause instanceof Error ? cause.message : 'unknown',
      });
    }

    if (!response.ok) {
      // El cuerpo puede traer detalles de la cuenta; al log va solo el estado.
      this.logger.error(`Supabase Storage respondió ${response.status} al firmar una subida.`);
      throw new DomainError('STORAGE_UNAVAILABLE', 'No pudimos preparar la subida.', {
        status: response.status,
      });
    }

    const body = (await response.json()) as { url?: string };
    if (!body.url) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'No pudimos preparar la subida.', {});
    }

    return {
      // Supabase devuelve la ruta relativa con el token adentro.
      uploadUrl: `${this.base}/storage/v1${body.url.startsWith('/') ? '' : '/'}${body.url}`,
      expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1_000),
    };
  }

  publicUrl(key: string): string {
    return `${this.base}/storage/v1/object/public/${this.bucket}/${key}`;
  }
}

/**
 * Cuánto vive la autorización para subir.
 *
 * Cinco minutos: de sobra para que una foto salga de un teléfono con mala
 * señal, y poco para que una URL filtrada sirva de algo. Quien tarde más pide
 * otra, que no cuesta nada.
 */
const SIGNED_URL_SECONDS = 5 * 60;
