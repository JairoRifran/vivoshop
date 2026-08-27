'use server';

import type { UploadPurpose } from '@vivo/domain';
import { api } from '@/lib/api';

export interface UploadTarget {
  readonly uploadUrl: string;
  readonly key: string;
  readonly maxBytes: number;
}

/**
 * Pide permiso para subir una imagen.
 *
 * Pasa por una acción de servidor y no por `fetch` desde el navegador porque la
 * sesión vive en una cookie de **este** origen: un `fetch` a la API desde el
 * cliente iría sin ella y volvería 401. Es la misma razón por la que
 * `savePushSubscription` es una acción y no una llamada directa.
 *
 * Lo que sí va directo desde el navegador son los bytes, contra la URL firmada
 * que esto devuelve. Esa URL se autoriza sola.
 */
export async function requestUpload(
  purpose: UploadPurpose,
  contentType: string,
): Promise<UploadTarget | null> {
  try {
    const client = await api();
    return await client.request<UploadTarget>('POST', '/media/uploads', { purpose, contentType });
  } catch {
    // La pantalla lo traduce a "no pudimos subir la imagen" y deja el resto del
    // formulario usable: nadie debería perder un cambio de nombre porque falló
    // una foto.
    return null;
  }
}
