import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Order, Payment, PaymentId, SellerPaymentAccount, Store, User } from '@vivo/domain';
import {
  DomainError,
  OAUTH_STATE_TTL_SECONDS,
  asPaymentId,
  assertPaymentTransition,
  canCollect,
  canPromiseProtection,
  commissionPolicy,
  isOAuthStateUsable,
  needsRefresh,
  orderShippedAt,
  orderStatusForPayment,
  shouldReleaseStock,
  splitPayment,
  toAccountView,
} from '@vivo/domain';
import { ENV, type AppEnv } from '../../config/env';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type {
  OAuthStateRepository,
  PaymentProviderPort,
  PaymentRepository,
  PaymentTransaction,
  PaymentTransactionRunner,
  SellerPaymentAccountRepository,
} from '../ports/payments';
import {
  OAUTH_STATE_REPOSITORY,
  PAYMENT_PROVIDER_PORT,
  PAYMENT_REPOSITORY,
  PAYMENT_TRANSACTION_RUNNER,
  SELLER_PAYMENT_ACCOUNT_REPOSITORY,
} from '../ports/payments';
import type { RealtimePublisher } from '../ports/realtime';
import type { UserRepository } from '../ports/repositories';
import { CLOCK, ID_GENERATOR, REALTIME_PUBLISHER, USER_REPOSITORY } from '../ports/tokens';
import { BidService } from './bid.service';
import { LiveService } from './live.service';

/**
 * Todo lo que pasa con el dinero, en un solo lugar.
 *
 * Tres reglas ordenan este archivo, y las tres vienen de errores caros:
 *
 *  1. **El webhook es la autoridad.** El redirect del comprador no decide
 *     nada: se puede cerrar la pestaña, se puede falsificar la URL, se puede
 *     volver con `?status=approved` sin haber pagado. Lo único que marca un
 *     pedido como pago es el aviso del proveedor, y aun ese aviso no se cree:
 *     se usa para saber *qué* consultar, y el estado se lee de la API.
 *
 *  2. **Aplicar un aviso es atómico.** Registro del aviso, pago, pedido y
 *     stock se mueven juntos o no se mueve nada.
 *
 *  3. **"Venta confirmada" solo con plata.** El anuncio en tiempo real sale
 *     de acá, no de la creación del pedido.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(SELLER_PAYMENT_ACCOUNT_REPOSITORY)
    private readonly accounts: SellerPaymentAccountRepository,
    @Inject(OAUTH_STATE_REPOSITORY) private readonly oauthStates: OAuthStateRepository,
    @Inject(PAYMENT_TRANSACTION_RUNNER) private readonly transactions: PaymentTransactionRunner,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(ENV) private readonly env: AppEnv,
    private readonly liveService: LiveService,
    private readonly bids: BidService,
  ) {}

  /** Lo que la UI puede prometer. Ni una palabra más. */
  capabilities() {
    const capabilities = this.provider.capabilities();
    return { provider: this.provider.key, ...capabilities };
  }

  // --- Arrancar un cobro ------------------------------------------------------

  /**
   * Crea el pago de un pedido y devuelve a dónde mandar al comprador.
   *
   * Se llama **después** de que el pedido commiteó. Hablar con un tercero con
   * una transacción de base de datos abierta es cómo se consiguen tormentas de
   * locks en producción.
   */
  async startForOrder(order: Order, store: Store): Promise<Payment> {
    const existing = await this.payments.findByOrderId(order.id);
    // Reintentar el pago de un pedido no crea un segundo cobro.
    if (existing && existing.status === 'pending' && existing.checkoutUrl) return existing;

    const account = await this.requireCollectingAccount(store);
    const buyer = await this.users.findById(order.buyerId);
    /* c8 ignore next -- el pedido no existe sin comprador. */
    if (!buyer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Comprador inexistente.' });

    const policy = commissionPolicy(store.settings.commissionPolicy);
    const split = splitPayment(order.totalMinor, policy);
    const now = this.clock.now();
    const paymentId = asPaymentId(this.ids.generate('pay'));

    const pending: Payment = {
      id: paymentId,
      purpose: 'order',
      orderId: order.id,
      storeId: store.id,
      payerId: order.buyerId,
      status: 'pending',
      currency: order.currency,
      split,
      installments: order.payment.installments,
      provider: this.provider.key,
      providerIntentId: null,
      providerPaymentId: null,
      checkoutUrl: null,
      failureReason: null,
      expiresAt: null,
      approvedAt: null,
      refundedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Se guarda antes de llamar al proveedor: si la llamada falla, queda el
    // registro de que se intentó y el comprador puede reintentar sobre él.
    await this.payments.create(pending);

    const session = await this.provider.createCheckout({
      paymentId,
      purpose: 'order',
      description: `${store.name} — pedido ${order.code}`,
      currency: order.currency,
      grossMinor: split.grossMinor,
      commissionMinor: split.commissionMinor,
      installments: order.payment.installments,
      sellerAccount: account,
      payer: { email: buyer.email, name: buyer.name },
      returnUrls: {
        success: `${this.webBase()}/compras/${order.id}?pago=aprobado`,
        failure: `${this.webBase()}/compras/${order.id}?pago=rechazado`,
        pending: `${this.webBase()}/compras/${order.id}?pago=pendiente`,
      },
      notificationUrl: `${this.env.API_PUBLIC_URL}/payments/webhook/${this.provider.key}`,
      externalReference: String(paymentId),
    });

    return this.payments.update({
      ...pending,
      providerIntentId: session.intentId,
      checkoutUrl: session.checkoutUrl,
      expiresAt: session.expiresAt,
      updatedAt: this.clock.now(),
    });
  }

  // --- El webhook -------------------------------------------------------------

  /**
   * Aplica un aviso del proveedor. Idempotente por construcción.
   *
   * Devuelve siempre sin lanzar cuando el aviso no corresponde a nada nuestro:
   * un proveedor que recibe un 500 reintenta para siempre, y no hay nada que
   * reintentar cuando el aviso no era para nosotros.
   */
  async handleWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): Promise<void> {
    const notification = this.provider.parseWebhook(input);
    if (!notification) return;

    const account = await this.resolveAccount(notification);
    if (!account) {
      this.logger.warn('Aviso sin cuenta resoluble; se ignora.');
      return;
    }

    // La verdad se consulta; no se lee del cuerpo del aviso. Un aviso puede
    // llegar tarde, repetido o adulterado — la API del proveedor, no.
    const providerPayment = await this.provider.getPayment({
      providerPaymentId: notification.providerPaymentId,
      sellerAccount: account,
    });

    const paymentId = providerPayment.externalReference
      ? asPaymentId(providerPayment.externalReference)
      : null;
    if (!paymentId) {
      this.logger.warn('Aviso sin referencia externa; se ignora.');
      return;
    }

    const outcome = await this.transactions.run(async (tx) => {
      const claimed = await tx.claimWebhookEvent({
        provider: this.provider.key,
        eventId: notification.eventId,
        paymentId,
      });
      // Ya procesado. Volver a aplicarlo descontaría stock dos veces.
      if (!claimed) return null;

      return this.applyInsideTransaction(tx, {
        paymentId,
        providerPaymentId: notification.providerPaymentId,
        status: providerPayment.status,
        failureReason: providerPayment.failureReason,
        approvedAt: providerPayment.approvedAt,
      });
    });

    if (outcome?.announce) {
      await this.announceApproved(outcome.order, outcome.payment);
      // Si el pedido salió de una puja, la puja terminó en venta. No lanza
      // cuando no salió de una: la mayoría de los pagos son checkout normal.
      if (outcome.order) {
        await this.bids.markSold(outcome.order.id).catch(() => undefined);
      }
    }
  }

  private async applyInsideTransaction(
    tx: PaymentTransaction,
    input: {
      paymentId: PaymentId;
      providerPaymentId: string;
      status: Payment['status'];
      failureReason: string | null;
      approvedAt: Date | null;
    },
  ): Promise<{ payment: Payment; order: Order | null; announce: boolean } | null> {
    const payment = await tx.loadPayment(input.paymentId);
    if (!payment) return null;

    // El mismo estado dos veces no es un error, es un reintento del proveedor
    // con el pago ya resuelto. Se registra el id y se sale.
    if (payment.status === input.status) {
      await tx.savePayment({ ...payment, providerPaymentId: input.providerPaymentId });
      return null;
    }

    // Un pago aprobado que "vuelve" a pendiente es un aviso viejo llegando
    // tarde. La máquina de estados lo rechaza en vez de retroceder el pedido.
    assertPaymentTransition(payment.status, input.status);

    const now = this.clock.now();
    const updated = await tx.savePayment({
      ...payment,
      status: input.status,
      providerPaymentId: input.providerPaymentId,
      failureReason: input.failureReason,
      approvedAt: input.approvedAt ?? (input.status === 'approved' ? now : payment.approvedAt),
      refundedAt: input.status === 'refunded' ? now : payment.refundedAt,
      updatedAt: now,
    });

    if (!updated.orderId) return { payment: updated, order: null, announce: false };

    const order = await tx.loadOrder(updated.orderId);
    /* c8 ignore next -- el pago referencia un pedido que existe. */
    if (!order) return { payment: updated, order: null, announce: false };

    const nextStatus = orderStatusForPayment(input.status);
    if (!nextStatus) return { payment: updated, order, announce: false };

    // Devolver dinero y devolver producto no son lo mismo: después del envío
    // la mercadería salió y reponerla inventaría unidades que no están.
    if (shouldReleaseStock({ paymentStatus: input.status, shippedAt: orderShippedAt(order) })) {
      await tx.releaseStock(order);
    }

    const saved = await tx.saveOrder({
      ...order,
      status: nextStatus,
      protection: this.nextProtection(order, input.status),
      payment: {
        ...order.payment,
        status: input.status,
        reference: input.providerPaymentId,
        paidAt: input.status === 'approved' ? (input.approvedAt ?? now) : order.payment.paidAt,
      },
      timeline: [...order.timeline, { status: nextStatus, at: now, note: null }],
      updatedAt: now,
    });

    return { payment: updated, order: saved, announce: input.status === 'approved' };
  }

  /**
   * Un pago aprobado protege la compra **solo si el proveedor puede
   * sostenerlo**. Con un proveedor que no retiene, la compra sigue
   * `not_applicable` y la UI no muestra el escudo.
   */
  private nextProtection(order: Order, status: Payment['status']): Order['protection'] {
    if (status !== 'approved') return order.protection;
    if (order.protection !== 'eligible') return order.protection;
    return canPromiseProtection(this.provider.capabilities()) ? 'protected' : 'not_applicable';
  }

  /**
   * "Venta confirmada", y recién ahora.
   *
   * Dos eventos distintos a propósito: la consola del vendedor recibe montos y
   * el id del pedido porque es su tienda; la sala pública recibe solo el
   * título de un producto, sin comprador, sin monto y sin id, para que el
   * empujón social no filtre quién compró qué.
   */
  private async announceApproved(order: Order | null, payment: Payment): Promise<void> {
    if (!order) return;

    try {
      await this.realtime.paymentApproved(order.storeId, {
        liveSessionId: order.liveSessionId ? String(order.liveSessionId) : null,
        orderId: String(order.id),
        orderCode: order.code,
        currency: payment.currency,
        grossMinor: payment.split.grossMinor,
        netMinor: payment.split.netMinor,
        productTitles: order.items.map((item) => item.titleSnapshot),
      });

      if (!order.liveSessionId) return;

      const stats = await this.liveService.stats(order.liveSessionId);
      await this.realtime.orderCreated(order.storeId, {
        liveSessionId: String(order.liveSessionId),
        orderId: String(order.id),
        unitsSold: stats.unitsSold,
        ordersCount: stats.ordersCount,
        revenueMinor: stats.revenueMinor,
        currency: stats.currency,
        productTitles: order.items.map((item) => item.titleSnapshot),
      });

      const headline = order.items[0]?.titleSnapshot;
      if (headline) {
        await this.realtime.saleAnnounced({
          liveSessionId: String(order.liveSessionId),
          productTitle: headline,
        });
      }
    } catch {
      // Un socket que nadie escucha no puede deshacer un cobro que ocurrió.
    }
  }

  // --- Conexión de la cuenta del vendedor --------------------------------------

  async accountView(store: Store) {
    const account = await this.accounts.find(store.id, this.provider.key);
    return account ? toAccountView(account) : null;
  }

  /** Los cobros de una tienda, para su panel. Sin nada del comprador. */
  async listForStore(store: Store): Promise<Payment[]> {
    return this.payments.listByStore(store.id);
  }

  /** Emite el `state` y devuelve a dónde mandar al vendedor. */
  async startConnection(store: Store): Promise<{ authorizationUrl: string }> {
    const now = this.clock.now();
    const state = this.ids.generate('oas');

    await this.oauthStates.create({
      state,
      storeId: store.id,
      provider: this.provider.key,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000),
      consumedAt: null,
    });

    return {
      authorizationUrl: this.provider.authorizationUrl({
        state,
        redirectUri: this.oauthRedirectUri(),
      }),
    };
  }

  /**
   * Cierra la conexión.
   *
   * El `state` se consume una sola vez y se valida antes de tocar nada: sin
   * eso, cualquiera podría inducir a un vendedor a conectar la cuenta de otro
   * a su tienda.
   */
  async completeConnection(input: { code: string; state: string }): Promise<{ storeId: string }> {
    const now = this.clock.now();
    const issued = await this.oauthStates.consume(input.state, now);
    if (!issued || !isOAuthStateUsable({ ...issued, consumedAt: null }, now)) {
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'El enlace para conectar la cuenta venció. Probá de nuevo desde la tienda.',
      });
    }

    const tokens = await this.provider.exchangeCode({
      code: input.code,
      redirectUri: this.oauthRedirectUri(),
    });

    await this.accounts.save({
      storeId: issued.storeId,
      provider: this.provider.key,
      status: 'connected',
      externalAccountId: tokens.externalAccountId,
      externalAccountLabel: tokens.externalAccountLabel,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      connectedAt: now,
      updatedAt: now,
    });

    return { storeId: String(issued.storeId) };
  }

  async disconnect(store: Store): Promise<void> {
    await this.accounts.remove(store.id, this.provider.key);
  }

  // --- Simulación (solo con el proveedor de desarrollo) ---------------------------

  /**
   * Resuelve un cobro simulado empujando el aviso por el **mismo** camino que
   * un webhook real. No hay un atajo que salte la idempotencia ni la
   * transacción: si esto pasa, el camino de producción pasa.
   */
  async simulate(intentId: string, outcome: 'approved' | 'rejected'): Promise<void> {
    const provider = this.provider as PaymentProviderPort & {
      settle?: (id: string, outcome: 'approved' | 'rejected') => { eventId: string; body: unknown } | null;
    };
    if (typeof provider.settle !== 'function') {
      throw new ConflictException({
        code: 'PAYMENT_UNAVAILABLE',
        message: 'Este entorno no simula pagos.',
      });
    }

    const event = provider.settle(intentId, outcome);
    if (!event) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ese cobro no existe.' });
    }

    await this.handleWebhook({ body: event.body, headers: {}, rawBody: JSON.stringify(event.body) });
  }

  // --- Internos ------------------------------------------------------------------

  /**
   * La cuenta con la que cobra una tienda, renovando el token si está por
   * vencer.
   *
   * El proveedor de desarrollo no necesita cuenta, y eso lo declara él mismo
   * (`requiresSellerAccount`). Preguntarle al servicio "¿sos el falso?" haría
   * que la excepción se multiplique por cada lugar que cobra.
   */
  private async requireCollectingAccount(store: Store): Promise<SellerPaymentAccount> {
    const now = this.clock.now();
    let account = await this.accounts.find(store.id, this.provider.key);

    if (!account && !this.provider.requiresSellerAccount) {
      return {
        storeId: store.id,
        provider: this.provider.key,
        status: 'connected',
        externalAccountId: `local-${String(store.id)}`,
        externalAccountLabel: store.name,
        accessToken: 'local',
        refreshToken: null,
        expiresAt: null,
        connectedAt: now,
        updatedAt: now,
      };
    }

    if (!account) {
      throw new DomainError(
        'SELLER_PAYMENT_ACCOUNT_MISSING',
        'Store has no payment account connected',
        { storeId: store.id },
      );
    }

    if (needsRefresh(account, now) && account.refreshToken) {
      account = await this.rotate(account);
    }

    if (!canCollect(account)) {
      throw new DomainError(
        'SELLER_PAYMENT_ACCOUNT_INVALID',
        'Connected account cannot receive payments',
        { storeId: store.id, status: account.status },
      );
    }

    return account;
  }

  private async rotate(account: SellerPaymentAccount): Promise<SellerPaymentAccount> {
    try {
      const tokens = await this.provider.refreshTokens(account.refreshToken as string);
      return this.accounts.save({
        ...account,
        status: 'connected',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? account.refreshToken,
        expiresAt: tokens.expiresAt,
        updatedAt: this.clock.now(),
      });
    } catch {
      // Marcar y seguir: el vendedor tiene que reconectar, y el error que
      // verá el comprador es el de cuenta inválida, no un fallo de red.
      return this.accounts.save({ ...account, status: 'expired', updatedAt: this.clock.now() });
    }
  }

  /**
   * De quién es la cuenta a la que le entró la plata.
   *
   * Hace falta antes de poder consultar nada: en un marketplace el pago vive
   * en la cuenta del vendedor y la API exige *su* credencial. Tres caminos, en
   * orden de confianza:
   *
   *  1. El aviso trae el id de la cuenta (primer aviso de un pago nuevo).
   *  2. El pago ya está guardado con ese id del proveedor (todo aviso
   *     posterior, que es la mayoría).
   *  3. El proveedor no usa cuentas —el simulado—, y entonces alcanza con una
   *     credencial local.
   *
   * El tercero se evalúa al final pero **no** depende de que los dos primeros
   * hayan fallado por completo: un proveedor sin cuentas encuentra el pago
   * guardado y aun así no tiene una fila de cuenta que devolver. Tratarlo como
   * "no resoluble" descartaba el aviso en silencio y dejaba el pedido colgado.
   */
  private async resolveAccount(notification: {
    providerPaymentId: string;
    providerAccountId: string | null;
  }): Promise<SellerPaymentAccount | null> {
    if (notification.providerAccountId) {
      const byExternal = await this.accounts.findByExternalId(
        this.provider.key,
        notification.providerAccountId,
      );
      if (byExternal) return byExternal;
    }

    const known = await this.payments.findByProviderPaymentId(
      this.provider.key,
      notification.providerPaymentId,
    );
    if (known) {
      const stored = await this.accounts.find(known.storeId, this.provider.key);
      if (stored) return stored;
      if (!this.provider.requiresSellerAccount) return this.localAccount(known.storeId);
      return null;
    }

    return this.provider.requiresSellerAccount ? null : this.localAccount(null);
  }

  /**
   * Una credencial de mentira para el proveedor que no usa cuentas.
   *
   * Solo la produce un proveedor que declaró `requiresSellerAccount === false`.
   * Con Mercado Pago este método no se alcanza nunca.
   */
  private localAccount(storeId: Store['id'] | null): SellerPaymentAccount {
    const now = this.clock.now();
    return {
      storeId: (storeId ?? '') as Store['id'],
      provider: this.provider.key,
      status: 'connected',
      externalAccountId: 'local',
      externalAccountLabel: null,
      accessToken: 'local',
      refreshToken: null,
      expiresAt: null,
      connectedAt: now,
      updatedAt: now,
    };
  }

  private oauthRedirectUri(): string {
    return `${this.env.API_PUBLIC_URL}/payments/${this.provider.key}/oauth/callback`;
  }

  private webBase(): string {
    return this.env.corsOrigins[0] ?? 'http://localhost:3000';
  }
}

/** Reexportado para los tipos de los controladores. */
export type { User };
