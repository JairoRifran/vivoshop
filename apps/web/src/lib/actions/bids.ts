'use server';

import type { BidSessionDto } from '@vivo/shared';
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

/**
 * Abrir la puja **no** revalida la pantalla de transmisión.
 *
 * Antes lo hacía, y era el bug que dejaba al vendedor con la cámara en negro y
 * "conexión inestable" a los pocos segundos de activar Modo Puja. Esa pantalla
 * no es una página cualquiera: sostiene un `MediaStream` de la cámara y una
 * sala de LiveKit publicando. Refrescarla en el medio de una transmisión es
 * pedirle al navegador que rearme las dos cosas mientras la persona está al
 * aire, y el costo lo paga entera la transmisión.
 *
 * No hacía falta ni siquiera para mostrar la puja: la consola reconcilia sola
 * —cada acción llama a `onChanged`, y `useBidSessions` además consulta al
 * servidor cada diez segundos porque acá se decide dinero—. Era una
 * revalidación que no aportaba nada y rompía lo único que no se puede
 * interrumpir.
 *
 * Ninguna de las otras acciones de puja revalidaba, y por eso el síntoma
 * aparecía exactamente al abrir y no al ofertar ni al aceptar.
 */
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
