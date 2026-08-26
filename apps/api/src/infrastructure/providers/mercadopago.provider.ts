import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { getCurrency } from '@vivo/config';
import { DomainError, type PaymentCapabilities, type PaymentStatus } from '@vivo/domain';
import { ENV, type AppEnv } from '../../config/env';
import type {
  CheckoutRequest,
  CheckoutSession,
  OAuthTokens,
  PaymentProviderPort,
  ProviderPayment,
  RefundRequest,
  WebhookNotification,
} from '../../application/ports/payments';

const API = 'https://api.mercadopago.com';
const AUTH = 'https://auth.mercadopago.com.uy/authorization';

/**
 * Mapa de estados: el vocabulario del proveedor entra acá y no sale.
 *
 * Es la razón de ser del adaptador. `in_process` y `in_mediation` son palabras
 * de Mercado Pago; el resto del sistema solo conoce los seis estados de
 * `PaymentStatus`. Un estado desconocido se trata como `pending`, que es la
 * lectura conservadora: no aprueba nada por las dudas.
 */
const STATUS_MAP: Record<string, PaymentStatus> = {
  pending: 'pending',
  in_process: 'pending',
  in_mediation: 'pending',
  authorized: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
  charged_back: 'refunded',
};

/**
 * Mercado Pago, modelo marketplace.
 *
 * El dinero va a la cuenta del vendedor y VivoShop retiene su comisión en el
 * mismo movimiento (`marketplace_fee`). VivoShop **no** es depositario de
 * fondos ajenos en ningún momento, que es un requisito legal antes que
 * técnico.
 *
 * ## Lo que este proveedor NO puede prometer
 *
 * Checkout Pro no permite decidir cuándo se le libera el dinero al vendedor:
 * Mercado Pago liquida según su propio calendario. Por eso
 * `supportsDelayedSettlement` es `false`, y por eso `protectionLevel()` da
 * `refund_only` en vez de `full`. La consecuencia es concreta y buscada: la UI
 * **no** muestra "retenemos tu dinero hasta que recibas el producto", porque
 * eso no está pasando. Muestra lo que sí es cierto: que si algo sale mal se
 * puede pedir la devolución y que hay un circuito de reclamos.
 *
 * El día que exista un proveedor —o un producto de Mercado Pago— que sí
 * retenga, cambia esta declaración y la promesa aparece sola. Ese es todo el
 * trabajo que debería costar.
 */
@Injectable()
export class MercadoPagoProvider implements PaymentProviderPort {
  readonly key = 'mercadopago';
  readonly requiresSellerAccount = true;

  private readonly logger = new Logger(MercadoPagoProvider.name);

  /**
   * Si las credenciales son de prueba.
   *
   * Lo decide **la credencial**, no `NODE_ENV`. Son dos ejes distintos y
   * confundirlos costó una tarde: el entorno dice dónde corre el proceso, la
   * credencial dice contra qué universo de Mercado Pago habla. Un despliegue
   * de producción con credenciales `TEST-` es exactamente lo que hace falta
   * para probar sin una máquina local, y es una combinación legítima.
   */
  private readonly sandbox: boolean;

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    this.sandbox = (env.MERCADOPAGO_ACCESS_TOKEN ?? '').startsWith('TEST-');
    if (!this.sandbox && !env.isProduction) {
      // Ruidoso a propósito: cobrarle de verdad a alguien que estaba probando
      // es el error caro de este milestone.
      this.logger.warn(
        'MERCADOPAGO_ACCESS_TOKEN no parece de sandbox. Verificá que no sean credenciales productivas.',
      );
    }
  }

  capabilities(): PaymentCapabilities {
    return {
      supportsDelayedSettlement: false,
      supportsManualRelease: false,
      supportsDisputes: true,
      supportsRefunds: true,
    };
  }

  // --- OAuth del vendedor -------------------------------------------------

  authorizationUrl(input: { state: string; redirectUri: string }): string {
    const url = new URL(AUTH);
    url.searchParams.set('client_id', this.env.MERCADOPAGO_CLIENT_ID ?? '');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return url.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    return this.oauthToken({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    });
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return this.oauthToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async oauthToken(extra: Record<string, string>): Promise<OAuthTokens> {
    const payload = await this.request<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      user_id?: number | string;
    }>('/oauth/token', {
      method: 'POST',
      token: this.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
      body: {
        client_id: this.env.MERCADOPAGO_CLIENT_ID,
        client_secret: this.env.MERCADOPAGO_CLIENT_SECRET,
        ...extra,
      },
    });

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
      externalAccountId: String(payload.user_id ?? ''),
      externalAccountLabel: null,
    };
  }

  // --- Cobro ---------------------------------------------------------------

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const preference = await this.request<{
      id: string;
      init_point?: string;
      sandbox_init_point?: string;
      expiration_date_to?: string;
    }>('/checkout/preferences', {
      method: 'POST',
      // La credencial del **vendedor**: el cobro entra en su cuenta.
      token: request.sellerAccount.accessToken ?? '',
      body: {
        items: [
          {
            id: String(request.paymentId),
            title: request.description,
            quantity: 1,
            currency_id: request.currency,
            unit_price: toMajor(request.grossMinor, request.currency),
          },
        ],
        // Lo que retiene VivoShop. Llega calculado por `CommissionPolicy`;
        // este adaptador no decide cuánto, solo lo transmite.
        marketplace_fee: toMajor(request.commissionMinor, request.currency),
        payer: { name: request.payer.name, email: request.payer.email },
        back_urls: {
          success: request.returnUrls.success,
          failure: request.returnUrls.failure,
          pending: request.returnUrls.pending,
        },
        auto_return: 'approved',
        // Esto es lo que decide si se cobró. El redirect no.
        notification_url: request.notificationUrl,
        external_reference: request.externalReference,
        payment_methods: { installments: request.installments },
        statement_descriptor: 'VIVOSHOP',
      },
    });

    /**
     * A qué host se manda al comprador.
     *
     * Una preferencia creada con credenciales `TEST-` **solo** se puede pagar
     * en `sandbox.mercadopago.com.uy`. La misma preferencia en `www.` muestra
     * "Oh, no, algo anduvo mal" y no crea ningún pago — sin dato de error, sin
     * llegar al webhook, sin nada que mirar del lado nuestro.
     *
     * Antes esto se elegía con `isProduction`, y por eso un despliegue de
     * producción con credenciales de prueba mandaba a todo el mundo al host
     * equivocado. Lo decide la credencial, que es quien sabe.
     */
    const checkoutUrl = this.sandbox
      ? (preference.sandbox_init_point ?? preference.init_point)
      : preference.init_point;

    if (!checkoutUrl) {
      throw new DomainError('PAYMENT_UNAVAILABLE', 'Mercado Pago returned no checkout URL');
    }

    return {
      intentId: preference.id,
      checkoutUrl,
      expiresAt: preference.expiration_date_to ? new Date(preference.expiration_date_to) : null,
    };
  }

  async getPayment(input: {
    providerPaymentId: string;
    sellerAccount: { accessToken: string | null };
  }): Promise<ProviderPayment> {
    const payment = await this.request<{
      id: number | string;
      status: string;
      status_detail?: string;
      external_reference?: string | null;
      transaction_amount?: number;
      currency_id?: string;
      installments?: number;
      date_approved?: string | null;
    }>(`/v1/payments/${input.providerPaymentId}`, {
      method: 'GET',
      token: input.sellerAccount.accessToken ?? this.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
    });

    return {
      providerPaymentId: String(payment.id),
      status: STATUS_MAP[payment.status] ?? 'pending',
      externalReference: payment.external_reference ?? null,
      amountMinor: toMinor(payment.transaction_amount ?? 0, payment.currency_id ?? 'UYU'),
      installments: payment.installments ?? 1,
      failureReason: payment.status_detail ?? null,
      approvedAt: payment.date_approved ? new Date(payment.date_approved) : null,
      // Mercado Pago liquida por su cuenta; no hay retención que informar.
      settlement: null,
    };
  }

  /**
   * Normaliza el aviso y valida que venga de Mercado Pago.
   *
   * La firma se verifica cuando hay secreto configurado. Sin verificar, este
   * endpoint sería un botón público para marcar pedidos como pagos: cualquiera
   * que conozca un id podría cantar una venta que no ocurrió. Aun así la firma
   * no es la última defensa —el estado se consulta después contra la API—,
   * pero es la primera y no debe faltar en producción.
   */
  parseWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): WebhookNotification | null {
    const body = input.body as {
      id?: number | string;
      type?: string;
      action?: string;
      user_id?: number | string;
      data?: { id?: string };
    } | null;

    if (!body?.data?.id) return null;
    // Mercado Pago avisa de varias cosas. Solo los pagos mueven un pedido.
    if (body.type && body.type !== 'payment') return null;

    const providerPaymentId = String(body.data.id);
    if (!this.verifySignature(input.headers, providerPaymentId)) {
      this.logger.warn('Aviso descartado: firma inválida.');
      return null;
    }

    return {
      // El id de la notificación identifica *este* aviso. Si faltara, dos
      // avisos del mismo pago se verían como uno y el segundo se perdería;
      // por eso el respaldo incluye la acción, que sí cambia entre avisos.
      eventId: body.id ? String(body.id) : `${providerPaymentId}:${body.action ?? 'payment'}`,
      providerPaymentId,
      providerAccountId: body.user_id ? String(body.user_id) : null,
    };
  }

  private verifySignature(
    headers: Record<string, string | string[] | undefined>,
    dataId: string,
  ): boolean {
    const secret = this.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
      // Sin secreto no se puede verificar. En producción es un agujero, así
      // que se dice en voz alta en vez de fallar en silencio.
      if (this.env.isProduction) {
        this.logger.error('MERCADOPAGO_WEBHOOK_SECRET sin configurar: los avisos no se verifican.');
      }
      return true;
    }

    const signature = header(headers, 'x-signature');
    const requestId = header(headers, 'x-request-id');
    if (!signature) return false;

    const parts = new Map(
      signature.split(',').map((part) => {
        const [key, value] = part.split('=', 2);
        return [key?.trim() ?? '', value?.trim() ?? ''] as const;
      }),
    );
    const ts = parts.get('ts');
    const v1 = parts.get('v1');
    if (!ts || !v1) return false;

    const manifest = `id:${dataId};request-id:${requestId ?? ''};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(v1, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async refund(request: RefundRequest): Promise<void> {
    const id = request.payment.providerPaymentId;
    if (!id) throw new DomainError('PAYMENT_UNAVAILABLE', 'Payment has no provider id');

    await this.request(`/v1/payments/${id}/refunds`, {
      method: 'POST',
      token: request.sellerAccount.accessToken ?? '',
      body:
        request.amountMinor === null
          ? {}
          : { amount: toMajor(request.amountMinor, request.payment.currency) },
      idempotencyKey: `refund-${id}-${request.amountMinor ?? 'full'}`,
    });
  }

  // `releaseSettlement` no está implementado a propósito: `supportsManualRelease`
  // es false y el puerto lo declara opcional. Un método que fingiera liberar
  // sería peor que su ausencia.

  // --- HTTP ------------------------------------------------------------------

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT';
      token: string;
      body?: unknown;
      idempotencyKey?: string;
    },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    };
    if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

    /**
     * El tipo se deriva de `fetch`, no del nombre global `Response`.
     *
     * La API compila con `lib: ["ES2023"]` —sin DOM—, así que `Response` como
     * nombre global sale de los `@types` que haya instalados, y eso cambia
     * entre entornos: en uno resolvió a un tipo sin `.text()`, `.ok` ni
     * `.status` y el build rompió ahí y en ningún otro lado. Anotar con el
     * nombre global era una dependencia gratuita del entorno; derivarlo de la
     * función que produce el valor no puede desincronizarse.
     */
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${API}${path}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new DomainError('PAYMENT_UNAVAILABLE', 'Mercado Pago is unreachable', {
        path,
        cause: error instanceof Error ? error.message : 'unknown',
      });
    }

    const text = await response.text();
    if (!response.ok) {
      // El cuerpo puede traer datos del comprador; al log va solo el estado.
      this.logger.error(`Mercado Pago ${options.method} ${path} respondió ${response.status}`);
      throw new DomainError('PAYMENT_UNAVAILABLE', 'Mercado Pago rejected the request', {
        path,
        status: response.status,
      });
    }

    return (text ? JSON.parse(text) : {}) as T;
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Unidades menores a lo que espera el proveedor. `CLP` no tiene centavos. */
function toMajor(amountMinor: number, currency: string): number {
  const units = getCurrency(currency as never).minorUnits;
  return amountMinor / 10 ** units;
}

function toMinor(amount: number, currency: string): number {
  const units = getCurrency(currency as never).minorUnits;
  return Math.round(amount * 10 ** units);
}
