'use server';

import type { BidSessionDto } from '@vivo/shared';
import { revalidatePath } from 'next/cache';
import { api } from '../api';
import { failure, type ActionState } from './shared';

/**
 * Modo Puja, del lado del navegador.
 *
 * Todas las acciones mandan lo mínimo —un id y, cuando corresponde, un monto—
 * y devuelven el estado que calculó el servidor. Ninguna decide nada: quién
 * lidera, cuál es el mínimo siguiente y si la reserva sigue viva son
 * respuestas del servidor, no del cliente.
 */

export async function bidsForLive(liveSessionId: string): Promise<BidSessionDto[]> {
  try {
    const client = await api();
    return await client.bids.forLive(liveSessionId);
  } catch {
    // Una puja que no carga no puede romper el vivo: el video y el chat
    // siguen. La pantalla simplemente no muestra el panel.
    return [];
  }
}

export async function placeBid(bidSessionId: string, amountMinor: number): Promise<ActionState> {
  try {
    const client = await api();
    await client.bids.submit(bidSessionId, { amountMinor });
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

export async function openBidSession(input: {
  liveSessionId: string;
  productId: string;
  variantId?: string;
  minimumBidMinor: number | null;
  minimumIncrementMinor: number | null;
}): Promise<ActionState> {
  try {
    const client = await api();
    await client.bids.open(input);
    revalidatePath(`/transmitir/${input.liveSessionId}`);
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

/**
 * El vendedor acepta una oferta.
 *
 * No hay nada que confirmar del lado del servidor más de una vez: aceptar es
 * idempotente para la misma oferta, así que un reintento tras un timeout
 * devuelve el mismo ganador. La confirmación que sí hace falta es la del dedo,
 * y esa vive en el componente.
 */
export async function acceptBid(bidSessionId: string, bidId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.bids.accept(bidSessionId, { bidId });
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

export async function closeBidSession(bidSessionId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.bids.close(bidSessionId);
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

export async function reopenBidSession(bidSessionId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.bids.reopen(bidSessionId);
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}
