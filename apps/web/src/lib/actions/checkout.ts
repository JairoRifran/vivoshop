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
 * Places the order and settles the simulated payment in one submit.
 *
 * Two calls rather than one because that is the shape a real provider forces:
 * the order must exist before it can be paid, and the payment result arrives
 * separately. Keeping that split now means M02 replaces the second call with a
 * redirect and a webhook, and nothing else moves.
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

    // Cash on delivery has nothing to authorise: the order simply waits.
    if (text(form, 'paymentMethodId') !== 'uy-cash-on-delivery') {
      order = await client.orders.confirmPayment(order.id, { outcome: 'approved' });
    }
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/compras');
  redirect(`/compras/${order.id}?nuevo=1`);
}

export async function payOrder(orderId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.orders.confirmPayment(orderId, { outcome: 'approved' });
    revalidatePath(`/compras/${orderId}`);
    revalidatePath('/compras');
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
