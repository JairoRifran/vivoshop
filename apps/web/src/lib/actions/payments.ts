'use server';

import type { BusinessVerificationRequest } from '@vivo/shared';
import { revalidatePath } from 'next/cache';
import { api } from '../api';
import { failure, text, type ActionState } from './shared';

/**
 * Conectar la cuenta de cobro.
 *
 * Devuelve la URL en vez de redirigir desde el servidor para que el botón
 * pueda mostrar un error si el proveedor no responde. Redirigir a ciegas
 * dejaría al vendedor mirando una pantalla en blanco.
 */
export async function connectPaymentAccount(): Promise<ActionState & { url?: string }> {
  try {
    const client = await api();
    const { authorizationUrl } = await client.payments.connect();
    return { status: 'success', url: authorizationUrl };
  } catch (error) {
    return failure(error);
  }
}

export async function disconnectPaymentAccount(): Promise<ActionState> {
  try {
    const client = await api();
    await client.payments.disconnect();
    revalidatePath('/vender/cobros');
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Presenta los datos del negocio para obtener el ✓.
 *
 * El identificador tributario es obligatorio **acá** y en ningún otro lado del
 * producto. Que haga falta para verificarse no lo vuelve necesario para
 * vender: este formulario es opcional de punta a punta.
 */
export async function submitBusinessVerification(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const payload: BusinessVerificationRequest = {
    legalName: text(form, 'legalName'),
    taxId: text(form, 'taxId'),
    responsibleName: text(form, 'responsibleName'),
    responsibleDocument: text(form, 'responsibleDocument'),
    commercialAddress: text(form, 'commercialAddress'),
    contactPhone: text(form, 'contactPhone'),
    contactEmail: text(form, 'contactEmail'),
  };

  try {
    const client = await api();
    await client.verification.submitBusiness(payload);
    revalidatePath('/vender/verificacion');
    return { status: 'success', message: 'Recibimos tus datos. Te avisamos cuando los revisemos.' };
  } catch (error) {
    return failure(error);
  }
}
