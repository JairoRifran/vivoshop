'use server';

import { isApiError, type CreateReportRequest } from '@vivo/shared';
import { revalidatePath } from 'next/cache';
import { api, getCurrentUser } from '../api';

export interface ModerationResult {
  readonly ok: boolean;
  /** Qué mostrarle a la persona. Nunca vacío cuando `ok` es falso. */
  readonly message: string;
  /** Sin sesión: la pantalla manda a ingresar en vez de fallar en silencio. */
  readonly requiresAuth?: boolean;
}

/**
 * Denunciar contenido.
 *
 * Va por el servidor y no por un `fetch` del navegador, por la misma razón que
 * el resto: la sesión vive en una cookie del dominio de la web, no del de la
 * API.
 *
 * Devuelve siempre un resultado en vez de tirar. Quien está denunciando algo ya
 * está incómodo; una pantalla de error es lo último que necesita.
 */
export async function reportContent(input: CreateReportRequest): Promise<ModerationResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: 'Ingresá para denunciar.', requiresAuth: true };

  try {
    const client = await api();
    await client.moderation.report(input);
    return {
      ok: true,
      // No promete que el contenido se baje: no se baja solo. Prometer eso y
      // que siga ahí es peor que no ofrecer el botón.
      message: 'Gracias. Lo vamos a revisar.',
    };
  } catch (error) {
    return { ok: false, message: mensajeDe(error, 'No pudimos enviar la denuncia.') };
  }
}

/** Bloquear es inmediato y privado: la otra persona no se entera. */
export async function blockUser(userId: string): Promise<ModerationResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: 'Ingresá para bloquear.', requiresAuth: true };

  try {
    const client = await api();
    await client.moderation.block(userId);
    revalidatePath('/perfil');
    return { ok: true, message: 'Listo. No vas a ver más lo que escriba.' };
  } catch (error) {
    return { ok: false, message: mensajeDe(error, 'No pudimos bloquear la cuenta.') };
  }
}

export async function unblockUser(userId: string): Promise<ModerationResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: 'Ingresá primero.', requiresAuth: true };

  try {
    const client = await api();
    await client.moderation.unblock(userId);
    revalidatePath('/perfil');
    return { ok: true, message: 'Desbloqueada.' };
  } catch (error) {
    return { ok: false, message: mensajeDe(error, 'No pudimos desbloquear la cuenta.') };
  }
}

function mensajeDe(error: unknown, porDefecto: string): string {
  // El mensaje del dominio es más útil que uno genérico: "No podés bloquearte a
  // vos mismo" explica; "algo salió mal" no.
  if (isApiError(error) && error.message) return error.message;
  return porDefecto;
}
