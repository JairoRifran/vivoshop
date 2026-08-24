import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canPromiseProtection, protectionLevel } from '@vivo/domain';
import { loadEnv, type AppEnv } from '../../config/env';
import { MercadoPagoProvider } from './mercadopago.provider';

/**
 * El adaptador de Mercado Pago.
 *
 * Lo que se prueba acá es la traducción, que es su única razón de existir: el
 * vocabulario del proveedor entra y no sale. Nada de lo que devuelve puede
 * contener `in_process`, `collector` ni `marketplace_fee`.
 *
 * Ninguna de estas pruebas toca la red. `fetch` está interceptado: probar
 * contra el servidor real haría que la suite dependiera de la conectividad y
 * de una cuenta sandbox viva, y no probaría nada que no pruebe esto.
 */
const WEBHOOK_SECRET = 'secreto-de-prueba';

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...loadEnv({
      NODE_ENV: 'test',
      DATA_DRIVER: 'memory',
      PAYMENT_PROVIDER: 'mercadopago',
      MERCADOPAGO_CLIENT_ID: '5966282054444446',
      MERCADOPAGO_CLIENT_SECRET: 'test-client-secret',
      MERCADOPAGO_ACCESS_TOKEN: 'TEST-access-token',
      MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET,
      API_PUBLIC_URL: 'https://api.example.uy',
    }),
    ...overrides,
  };
}

/** La firma tal como la arma Mercado Pago: manifiesto + HMAC-SHA256. */
function signature(dataId: string, requestId: string, ts = '1700000000'): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('capacidades: lo que este proveedor puede sostener', () => {
  const provider = new MercadoPagoProvider(env());

  it('no puede retener el dinero, y lo dice', () => {
    // Checkout Pro liquida según el calendario de Mercado Pago. Declarar
    // `supportsDelayedSettlement: true` sería mentir, y la UI mostraría
    // "retenemos tu dinero hasta la entrega" sobre un mecanismo inexistente.
    expect(provider.capabilities().supportsDelayedSettlement).toBe(false);
  });

  it('la promesa que habilita es "te lo devolvemos", no el escudo', () => {
    expect(protectionLevel(provider.capabilities())).toBe('refund_only');
    expect(canPromiseProtection(provider.capabilities())).toBe(false);
  });

  it('exige que el vendedor conecte su cuenta', () => {
    // Modelo marketplace: la plata va a la cuenta del vendedor. Sin cuenta no
    // hay a dónde cobrar, y VivoShop no la recibe en su lugar.
    expect(provider.requiresSellerAccount).toBe(true);
  });
});

describe('OAuth', () => {
  const provider = new MercadoPagoProvider(env());

  it('manda al vendedor con el state anti-CSRF en la URL', () => {
    const url = new URL(
      provider.authorizationUrl({ state: 'st-123', redirectUri: 'https://api.example.uy/cb' }),
    );
    expect(url.searchParams.get('state')).toBe('st-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.uy/cb');
    // El secreto no viaja en una URL que abre un navegador.
    expect(url.toString()).not.toContain('test-client-secret');
  });
});

describe('traducción de estados', () => {
  let provider: MercadoPagoProvider;
  const account = { accessToken: 'seller-token' };

  beforeEach(() => {
    provider = new MercadoPagoProvider(env());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respondWith(payload: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
  }

  it('in_process es pendiente, no aprobado', async () => {
    respondWith({
      id: 111,
      status: 'in_process',
      external_reference: 'pay_1',
      transaction_amount: 2490,
      currency_id: 'UYU',
    });

    const payment = await provider.getPayment({
      providerPaymentId: '111',
      sellerAccount: account,
    });
    expect(payment.status).toBe('pending');
  });

  it('un estado que no conocemos se lee como pendiente', async () => {
    // Conservador a propósito: inventar "aprobado" ante lo desconocido sería
    // marcar como cobrado algo que no lo está.
    respondWith({ id: 112, status: 'estado_nuevo_de_mercado_pago', currency_id: 'UYU' });

    const payment = await provider.getPayment({
      providerPaymentId: '112',
      sellerAccount: account,
    });
    expect(payment.status).toBe('pending');
  });

  it('convierte el monto a unidades menores', async () => {
    respondWith({
      id: 113,
      status: 'approved',
      transaction_amount: 2490.5,
      currency_id: 'UYU',
      date_approved: '2026-03-01T10:00:00.000-03:00',
    });

    const payment = await provider.getPayment({
      providerPaymentId: '113',
      sellerAccount: account,
    });
    expect(payment.status).toBe('approved');
    expect(payment.amountMinor).toBe(249_050);
    expect(payment.approvedAt).toBeInstanceOf(Date);
  });

  it('un fallo de red se reporta como código estable, sin filtrar el cuerpo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET al hablar con api.mercadopago.com');
      }),
    );

    await expect(
      provider.getPayment({ providerPaymentId: '114', sellerAccount: account }),
    ).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
  });
});

describe('el cobro que se le pide al proveedor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cobra con la credencial del vendedor y transmite la comisión ya calculada', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({ id: 'pref-1', sandbox_init_point: 'https://sandbox/checkout' }),
          { status: 200 },
        );
      }),
    );

    const provider = new MercadoPagoProvider(env());
    const session = await provider.createCheckout({
      paymentId: 'pay_1' as never,
      purpose: 'order',
      description: 'Plaza Moda — pedido VV-1',
      currency: 'UYU',
      grossMinor: 249_000,
      commissionMinor: 7_470,
      installments: 1,
      sellerAccount: { accessToken: 'seller-token' } as never,
      payer: { email: 'ana@ejemplo.uy', name: 'Ana' },
      returnUrls: { success: 'https://web/ok', failure: 'https://web/no', pending: 'https://web/wait' },
      notificationUrl: 'https://api.example.uy/payments/webhook/mercadopago',
      externalReference: 'pay_1',
    });

    expect(session.intentId).toBe('pref-1');
    // Fuera de producción se usa el punto de sandbox: cobrarle de verdad a
    // alguien que estaba probando es el error caro de este milestone.
    expect(session.checkoutUrl).toBe('https://sandbox/checkout');

    const [call] = calls;
    const headers = call?.init.headers as Record<string, string>;
    // La credencial es la del vendedor, no la de la plataforma.
    expect(headers.Authorization).toBe('Bearer seller-token');

    const body = JSON.parse(call?.init.body as string);
    // El adaptador transmite la comisión; no la decide. El 3% vive en
    // `CommissionPolicy`, en el dominio.
    expect(body.marketplace_fee).toBe(74.7);
    expect(body.items[0].unit_price).toBe(2490);
    expect(body.notification_url).toBe('https://api.example.uy/payments/webhook/mercadopago');
    expect(body.external_reference).toBe('pay_1');
  });
});

describe('firma del webhook', () => {
  const provider = new MercadoPagoProvider(env());

  const body = { id: 9001, type: 'payment', action: 'payment.updated', data: { id: '111' }, user_id: 167865799 };

  it('acepta un aviso firmado y normaliza lo que trae', () => {
    const notification = provider.parseWebhook({
      body,
      headers: { 'x-signature': signature('111', 'req-1'), 'x-request-id': 'req-1' },
      rawBody: JSON.stringify(body),
    });

    expect(notification).toEqual({
      eventId: '9001',
      providerPaymentId: '111',
      providerAccountId: '167865799',
    });
  });

  it('rechaza un aviso con firma inválida', () => {
    // Sin esto, el webhook sería un botón público para marcar pedidos como
    // pagos: basta conocer un id.
    expect(
      provider.parseWebhook({
        body,
        headers: { 'x-signature': 'ts=1700000000,v1=deadbeef', 'x-request-id': 'req-1' },
        rawBody: JSON.stringify(body),
      }),
    ).toBeNull();
  });

  it('rechaza un aviso sin firma', () => {
    expect(
      provider.parseWebhook({ body, headers: {}, rawBody: JSON.stringify(body) }),
    ).toBeNull();
  });

  it('rechaza una firma válida para otro pago', () => {
    // El manifiesto incluye el id: reusar la firma de un aviso ajeno no sirve.
    expect(
      provider.parseWebhook({
        body,
        headers: { 'x-signature': signature('222', 'req-1'), 'x-request-id': 'req-1' },
        rawBody: JSON.stringify(body),
      }),
    ).toBeNull();
  });

  it('ignora avisos que no son de pagos', () => {
    expect(
      provider.parseWebhook({
        body: { id: 1, type: 'plan', data: { id: '111' } },
        headers: { 'x-signature': signature('111', 'req-1'), 'x-request-id': 'req-1' },
        rawBody: '{}',
      }),
    ).toBeNull();
  });

  it('distingue dos avisos del mismo pago', () => {
    // Si `eventId` fuera solo el id del pago, el segundo aviso —el que trae
    // la aprobación— se descartaría como duplicado del primero.
    const created = provider.parseWebhook({
      body: { type: 'payment', action: 'payment.created', data: { id: '111' } },
      headers: { 'x-signature': signature('111', 'req-1'), 'x-request-id': 'req-1' },
      rawBody: '{}',
    });
    const updated = provider.parseWebhook({
      body: { type: 'payment', action: 'payment.updated', data: { id: '111' } },
      headers: { 'x-signature': signature('111', 'req-2'), 'x-request-id': 'req-2' },
      rawBody: '{}',
    });

    expect(created?.eventId).not.toBe(updated?.eventId);
  });
});
