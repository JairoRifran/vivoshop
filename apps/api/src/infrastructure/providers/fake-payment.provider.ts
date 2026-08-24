import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentCapabilities } from '@vivo/domain';
import { asPaymentId } from '@vivo/domain';
import type { IdGenerator } from '../../application/ports/infrastructure';
import type {
  CheckoutRequest,
  CheckoutSession,
  OAuthTokens,
  PaymentProviderPort,
  ProviderPayment,
  RefundRequest,
  WebhookNotification,
} from '../../application/ports/payments';
import { ID_GENERATOR } from '../../application/ports/tokens';

/**
 * El proveedor de cobros para desarrollo y pruebas.
 *
 * Es una implementación *completa* del puerto y no un stub que devuelve
 * `true`. Eso es deliberado: mantiene registro de cada cobro, puede aprobar,
 * rechazar, retener, liberar y devolver, y su webhook pasa por el mismo camino
 * que el de Mercado Pago —misma normalización, misma clave de idempotencia,
 * misma transacción—. El día que se cambia el `PAYMENT_PROVIDER`, lo único
 * distinto es a qué servidor se le habla.
 *
 * Declara capacidades completas porque las cumple de verdad: retiene el dinero
 * en su propio mapa y solo lo libera cuando se lo piden. No está prometiendo
 * nada que no haga. Es, por eso, el único proveedor con el que la Compra
 * Protegida completa se puede ver funcionando de punta a punta hoy.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  readonly key = 'fake';
  /** No hay cuentas que conectar: cualquier tienda puede cobrar en desarrollo. */
  readonly requiresSellerAccount = false;

  private readonly logger = new Logger(FakePaymentProvider.name);

  /** Lo que este proveedor "sabe" de cada cobro. Se vacía al reiniciar. */
  private readonly payments = new Map<string, ProviderPayment>();
  /** Qué intención produjo qué pago, para poder resolver el aviso. */
  private readonly intents = new Map<string, string>();

  constructor(@Inject(ID_GENERATOR) private readonly ids: IdGenerator) {}

  capabilities(): PaymentCapabilities {
    return {
      supportsDelayedSettlement: true,
      supportsManualRelease: true,
      supportsDisputes: true,
      supportsRefunds: true,
    };
  }

  // --- OAuth ----------------------------------------------------------------

  authorizationUrl(input: { state: string; redirectUri: string }): string {
    const url = new URL(input.redirectUri);
    url.searchParams.set('code', `fake-code-${input.state}`);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    const account = this.ids.generate('fakeacct');
    return {
      accessToken: `fake-access-${input.code}`,
      refreshToken: `fake-refresh-${account}`,
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000),
      externalAccountId: account,
      externalAccountLabel: 'Cuenta de prueba',
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return {
      accessToken: `fake-access-${this.ids.generate('rot')}`,
      refreshToken,
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000),
      externalAccountId: refreshToken.replace('fake-refresh-', ''),
      externalAccountLabel: 'Cuenta de prueba',
    };
  }

  // --- Cobro ----------------------------------------------------------------

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const intentId = this.ids.generate('fakeint');
    const providerPaymentId = this.ids.generate('fakepay');

    this.intents.set(intentId, providerPaymentId);
    this.payments.set(providerPaymentId, {
      providerPaymentId,
      status: 'pending',
      externalReference: request.externalReference,
      amountMinor: request.grossMinor,
      installments: request.installments,
      failureReason: null,
      approvedAt: null,
      settlement: 'pending_release',
    });

    this.logger.debug(
      `Cobro simulado ${intentId}: ${request.grossMinor} ${request.currency} ` +
        `(comisión ${request.commissionMinor}) en ${request.installments}x`,
    );

    // La URL vuelve a la propia web, a una pantalla que pregunta el desenlace.
    // El comprador "sale" de la app y vuelve, igual que con un proveedor real,
    // asi que el checkout no tiene un camino especial para desarrollo.
    const checkoutUrl = new URL(request.returnUrls.pending);
    checkoutUrl.searchParams.set('simular', intentId);

    return {
      intentId,
      checkoutUrl: checkoutUrl.toString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async getPayment(input: { providerPaymentId: string }): Promise<ProviderPayment> {
    const known = this.payments.get(input.providerPaymentId);
    if (known) return known;

    // Un pago que este proceso no vio (reinicio, otra réplica) se reporta
    // pendiente en vez de inventar un estado.
    return {
      providerPaymentId: input.providerPaymentId,
      status: 'pending',
      externalReference: null,
      amountMinor: 0,
      installments: 1,
      failureReason: null,
      approvedAt: null,
      settlement: 'pending_release',
    };
  }

  parseWebhook(input: {
    body: unknown;
    headers?: Record<string, string | string[] | undefined>;
    rawBody?: string;
  }): WebhookNotification | null {
    const body = input.body as {
      id?: string;
      type?: string;
      data?: { id?: string };
    } | null;

    if (!body || body.type !== 'payment' || !body.data?.id || !body.id) return null;
    return { eventId: body.id, providerPaymentId: body.data.id, providerAccountId: null };
  }

  async refund(request: RefundRequest): Promise<void> {
    const id = request.payment.providerPaymentId;
    if (!id) return;
    const current = this.payments.get(id);
    if (!current) return;
    this.payments.set(id, { ...current, status: 'refunded' });
  }

  async releaseSettlement(input: {
    payment: { providerPaymentId: string | null };
  }): Promise<void> {
    const id = input.payment.providerPaymentId;
    if (!id) return;
    const current = this.payments.get(id);
    if (!current) return;
    this.payments.set(id, { ...current, settlement: 'released' });
  }

  // --- Solo para el endpoint de simulación ------------------------------------

  /**
   * Decide el desenlace de una intención y devuelve el aviso que el proveedor
   * "habría" mandado.
   *
   * Existe fuera del puerto porque ningún proveedor real tiene un método para
   * decidir si un pago sale bien. Lo consume el endpoint de simulación, que
   * después empuja el aviso por el mismo camino que el webhook de verdad —con
   * su idempotencia y su transacción— en lugar de saltárselo.
   */
  settle(intentId: string, outcome: 'approved' | 'rejected'): {
    eventId: string;
    body: unknown;
  } | null {
    const providerPaymentId = this.intents.get(intentId);
    if (!providerPaymentId) return null;

    const current = this.payments.get(providerPaymentId);
    /* c8 ignore next -- se crean juntos en createCheckout. */
    if (!current) return null;

    this.payments.set(providerPaymentId, {
      ...current,
      status: outcome,
      failureReason: outcome === 'rejected' ? 'simulated_rejection' : null,
      approvedAt: outcome === 'approved' ? new Date() : null,
    });

    const eventId = `fake-evt-${providerPaymentId}-${outcome}`;
    return { eventId, body: { id: eventId, type: 'payment', data: { id: providerPaymentId } } };
  }

  /** El id de nuestro pago detrás de una intención, para validar permisos. */
  paymentIdForIntent(intentId: string) {
    const providerPaymentId = this.intents.get(intentId);
    const reference = providerPaymentId
      ? this.payments.get(providerPaymentId)?.externalReference
      : null;
    return reference ? asPaymentId(reference) : null;
  }
}
