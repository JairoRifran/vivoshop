'use server';

import type { AddressDto, CheckoutPreviewDto, OrderDto } from '@vivo/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, getCurrentUser } from '../api';
import { failure, number, optionalText, text, type ActionState } from './shared';

export async function previewCheckout(input: {
  storeId: string;
  productId: string;
  variantId: string;
  quantity: number;
  deliveryMethodId: string;
  installments: number;
}): Promise<CheckoutPreviewDto | null> {
  try {
    const client = await api();
    return await client.orders.preview(input.storeId, {
      lines: [
        { productId: input.productId, variantId: input.variantId, quantity: input.quantity },
      ],
      deliveryMethodId: input.deliveryMethodId,
      installments: input.installments,
    });
  } catch {
    return null;
  }
}

/**
 * Crea el pedido y manda al comprador a pagar.
 *
 * El pedido existe antes de que exista el cobro, y el cobro se resuelve fuera
 * de la app. Eso no es una complicacion nuestra: es la forma que tiene
 * cualquier proveedor real, y la razon por la que el resultado no vuelve por
 * este camino sino por el webhook.
 *
 * Contra pago contra entrega no hay nada que autorizar: el pedido espera.
 */
export async function placeOrder(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const storeId = text(form, 'storeId');

  if (!user) {
    const back = text(form, 'returnTo') || '/';
    redirect(`/ingresar?next=${encodeURIComponent(back)}`);
  }

  const deliveryMethodId = text(form, 'deliveryMethodId');
  const requiresAddress = text(form, 'requiresAddress') === 'true';

  const address: AddressDto | null = requiresAddress
    ? {
        id: null,
        recipientName: text(form, 'recipientName'),
        phone: text(form, 'phone'),
        country: 'UY',
        regionCode: text(form, 'regionCode'),
        regionName: text(form, 'regionName'),
        locality: text(form, 'locality'),
        street: text(form, 'street'),
        postalCode: optionalText(form, 'postalCode'),
        notes: optionalText(form, 'notes'),
      }
    : null;

  /**
   * The key comes from the form, generated once when the checkout screen
   * mounted. A retry — double tap, browser resend, flaky connection — reuses
   * it, so the server returns the original order instead of creating a second.
   */
  const idempotencyKey = text(form, 'idempotencyKey');

  let order: OrderDto;
  try {
    const client = await api();
    order = await client.orders.create(
      storeId,
      {
        lines: [
          {
            productId: text(form, 'productId'),
            variantId: text(form, 'variantId'),
            quantity: number(form, 'quantity', 1),
            // Solo el id de la oferta. El precio lo resuelve el servidor.
            ...(optionalText(form, 'bidId') ? { bidId: text(form, 'bidId') } : {}),
          },
        ],
        deliveryMethodId,
        paymentMethodId: text(form, 'paymentMethodId'),
        installments: number(form, 'installments', 1),
        address,
        buyerNote: optionalText(form, 'buyerNote'),
        liveSessionId: optionalText(form, 'liveSessionId'),
      },
      idempotencyKey,
    );

  } catch (error) {
    return failure(error);
  }

  revalidatePath('/compras');

  // `redirect` lanza, asi que va fuera del try: adentro lo atraparia el
  // `catch` y el comprador veria un error despues de una compra que si se
  // creo. Es el bug clasico de las server actions de Next.
  const checkoutUrl = order.payment.checkoutUrl;
  if (checkoutUrl) redirect(checkoutUrl);

  redirect(`/compras/${order.id}?nuevo=1`);
}

/**
 * Reintenta el cobro de un pedido que quedo sin pagar.
 *
 * Devuelve la URL en vez de redirigir para que el boton pueda mostrar un
 * error si el cobro no se pudo abrir. Redirigir desde aca dejaria al
 * comprador mirando una pagina en blanco cuando el proveedor esta caido.
 */
export async function startPayment(orderId: string): Promise<ActionState & { url?: string }> {
  try {
    const client = await api();
    const payment = await client.orders.startPayment(orderId);
    if (!payment.checkoutUrl) {
      return { status: 'error', message: 'No pudimos abrir el pago. Probá de nuevo en un momento.' };
    }
    return { status: 'success', url: payment.checkoutUrl };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Resuelve un cobro simulado.
 *
 * Solo existe con el proveedor de desarrollo; la API lo rechaza con cualquier
 * otro. Empuja el aviso por el mismo camino que el webhook real.
 */
export async function simulatePayment(
  orderId: string,
  outcome: 'approved' | 'rejected',
): Promise<ActionState> {
  try {
    const client = await api();
    await client.orders.simulatePayment(orderId, { outcome });
    revalidatePath(`/compras/${orderId}`);
    revalidatePath('/compras');
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

/** "Recibi mi compra". Cierra la operacion; no libera el dinero. */
export async function confirmReceipt(orderId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.orders.confirmReceipt(orderId);
    revalidatePath(`/compras/${orderId}`);
    revalidatePath('/compras');
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

export async function openDispute(
  orderId: string,
  reason: 'not_received' | 'wrong_item' | 'damaged' | 'not_as_described',
  detail: string,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.orders.openDispute(orderId, { reason, detail });
    revalidatePath(`/compras/${orderId}`);
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelOrder(orderId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.orders.cancel(orderId);
    revalidatePath(`/compras/${orderId}`);
    revalidatePath('/compras');
    return { status: 'success' };
  } catch (error) {
    return failure(error);
  }
}
