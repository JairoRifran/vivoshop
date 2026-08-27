'use server';

import { parseMoneyInput } from '@vivo/config';
import type { OrderStatus } from '@vivo/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '../api';
import { failure, mediaKey, number, optionalText, success, text, type ActionState } from './shared';

const SELLER_PATHS = ['/vender', '/vender/productos', '/vender/pedidos', '/vender/lives'];

function revalidateSeller(): void {
  for (const path of SELLER_PATHS) revalidatePath(path);
}

export async function becomeSeller(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await api();
    await client.stores.create({
      name: text(form, 'name'),
      description: text(form, 'description'),
      category: (text(form, 'category') || 'otros') as never,
      ...(text(form, 'city') ? { city: text(form, 'city') } : {}),
      country: 'UY',
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/', 'layout');
  redirect('/vender');
}

/**
 * Variants arrive as parallel arrays from the form: one row per variant with
 * a label, a stock count and an optional price override. Rows the seller left
 * blank are dropped, and a product with no rows at all gets a single default
 * variant so the rest of the system can always point at one.
 */
function readVariants(form: FormData, basePriceMinor: number) {
  const labels = form.getAll('variantLabel').map(String);
  const stocks = form.getAll('variantStock').map(String);
  const prices = form.getAll('variantPrice').map(String);
  const optionName = text(form, 'optionName') || 'Variante';

  const rows = labels
    .map((label, index) => ({
      label: label.trim(),
      stock: Number(stocks[index] ?? '0'),
      price: parseMoneyInput(prices[index] ?? '', 'UYU'),
    }))
    .filter((row) => row.label.length > 0);

  if (rows.length === 0) {
    return {
      options: [],
      variants: [
        {
          optionValues: {},
          sku: null,
          priceMinor: null,
          stock: number(form, 'stock', 0),
          active: true,
        },
      ],
    };
  }

  return {
    options: [{ name: optionName, values: rows.map((row) => row.label) }],
    variants: rows.map((row) => ({
      optionValues: { [optionName]: row.label },
      sku: null,
      priceMinor: row.price && row.price !== basePriceMinor ? row.price : null,
      stock: Number.isFinite(row.stock) ? Math.max(0, Math.trunc(row.stock)) : 0,
      active: true,
    })),
  };
}

export async function createProduct(_previous: ActionState, form: FormData): Promise<ActionState> {
  const basePriceMinor = parseMoneyInput(text(form, 'price'), 'UYU') ?? 0;
  const compareAt = parseMoneyInput(text(form, 'compareAtPrice'), 'UYU');
  const { options, variants } = readVariants(form, basePriceMinor);

  try {
    const client = await api();
    await client.products.create({
      title: text(form, 'title'),
      description: text(form, 'description'),
      basePriceMinor,
      compareAtPriceMinor: compareAt && compareAt > basePriceMinor ? compareAt : null,
      images: [],
      options,
      variants,
      status: text(form, 'status') === 'paused' ? 'paused' : 'active',
    });
  } catch (error) {
    return failure(error);
  }

  revalidateSeller();
  redirect('/vender/productos');
}

export async function updateProduct(
  productId: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const basePriceMinor = parseMoneyInput(text(form, 'price'), 'UYU') ?? 0;
  const compareAt = parseMoneyInput(text(form, 'compareAtPrice'), 'UYU');
  const { options, variants } = readVariants(form, basePriceMinor);

  try {
    const client = await api();
    await client.products.update(productId, {
      title: text(form, 'title'),
      description: text(form, 'description'),
      basePriceMinor,
      compareAtPriceMinor: compareAt && compareAt > basePriceMinor ? compareAt : null,
      options,
      variants,
      status: text(form, 'status') === 'paused' ? 'paused' : 'active',
    });
  } catch (error) {
    return failure(error);
  }

  revalidateSeller();
  redirect('/vender/productos');
}

export async function toggleProduct(productId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.products.toggle(productId);
    revalidateSeller();
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function createLive(_previous: ActionState, form: FormData): Promise<ActionState> {
  const mode = text(form, 'mode') === 'scheduled' ? 'scheduled' : 'now';
  const productIds = form.getAll('productIds').map(String).filter(Boolean);
  const localDateTime = text(form, 'scheduledAt');

  let created: { id: string; status: string };
  try {
    const client = await api();
    created = await client.live.create({
      title: text(form, 'title'),
      thumbnailUrl: null,
      productIds,
      mode,
      // `datetime-local` has no timezone; the browser typed it in local time,
      // so interpreting it as local and sending UTC is correct here.
      scheduledAt: mode === 'scheduled' && localDateTime ? new Date(localDateTime).toISOString() : null,
    });
  } catch (error) {
    return failure(error);
  }

  revalidateSeller();
  redirect(mode === 'now' ? `/transmitir/${created.id}` : '/vender');
}

export async function startLive(liveId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.live.start(liveId);
    revalidateSeller();
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function endLive(liveId: string): Promise<ActionState> {
  try {
    const client = await api();
    await client.live.end(liveId);
  } catch (error) {
    return failure(error);
  }

  revalidateSeller();
  redirect('/vender');
}

export async function featureProduct(
  liveId: string,
  productId: string | null,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.live.feature(liveId, { productId });
    revalidatePath(`/transmitir/${liveId}`);
    revalidatePath(`/live/${liveId}`);
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function advanceOrder(
  orderId: string,
  status: OrderStatus,
  note?: string,
): Promise<ActionState> {
  try {
    const client = await api();
    await client.orders.updateStatus(orderId, { status, note: note ?? null });
    revalidateSeller();
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function updateStoreSettings(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const threshold = parseMoneyInput(text(form, 'freeShippingThreshold'), 'UYU');

  try {
    const client = await api();
    await client.request('PATCH', '/seller/store', {
      name: text(form, 'name'),
      description: text(form, 'description'),
      city: optionalText(form, 'city'),
      whatsapp: optionalText(form, 'whatsapp'),
      logoKey: mediaKey(form, 'logoKey'),
      coverKey: mediaKey(form, 'coverKey'),
      freeShippingThresholdMinor: threshold && threshold > 0 ? threshold : null,
      pickupInstructions: optionalText(form, 'pickupInstructions'),
      status: text(form, 'status') === 'paused' ? 'paused' : 'active',
    });
  } catch (error) {
    return failure(error);
  }

  revalidateSeller();
  return success('Guardamos los cambios.');
}

/**
 * A publishing credential for the seller's own broadcast.
 *
 * Minted by the API after it re-checks store ownership; the LiveKit secret
 * never reaches this process, let alone the browser. Returns null rather than
 * throwing so the console can show "no pudimos conectar el video" while the
 * local camera preview keeps working.
 */
export async function broadcastCredentials(liveSessionId: string): Promise<unknown | null> {
  try {
    const client = await api();
    return await client.live.broadcastToken(liveSessionId);
  } catch {
    return null;
  }
}
