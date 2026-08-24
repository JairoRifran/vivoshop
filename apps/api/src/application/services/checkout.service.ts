import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getMarket } from '@vivo/config';
import type { Order, OrderId, Product, Store, StoreId, UserId } from '@vivo/domain';
import {
  DomainError,
  asLiveSessionId,
  asOrderId,
  asProductId,
  asVariantId,
  assertIdempotencyKey,
  buildCheckoutDraft,
  buildOrderCode,
  fingerprintRequest,
  idempotencyScope,
  installmentPreview,
  stockShortfallError,
  type CheckoutLineRequest,
  type StockReservationLine,
} from '@vivo/domain';
import type {
  CheckoutPreviewDto,
  CheckoutPreviewRequest,
  CreateOrderRequest,
  OrderDto,
} from '@vivo/shared';
import { toOrderDto, toStoreSummaryDto } from '../mappers/dto.mappers';
import type { Clock, IdGenerator, PaymentProvider } from '../ports/infrastructure';
import type { RealtimePublisher } from '../ports/realtime';
import type {
  OrderTransaction,
  OrderTransactionRunner,
} from '../ports/order-transaction';
import type { OrderRepository, ProductRepository } from '../ports/repositories';
import {
  CLOCK,
  ID_GENERATOR,
  ORDER_REPOSITORY,
  ORDER_TRANSACTION_RUNNER,
  PAYMENT_PROVIDER,
  PRODUCT_REPOSITORY,
  REALTIME_PUBLISHER,
} from '../ports/tokens';
import { LiveService } from './live.service';
import { StoreService } from './store.service';

/** Namespaced so a key can never leak across operations. */
const CREATE_ORDER_OPERATION = 'checkout.create-order';

/**
 * Checkout is the one place where money, stock and payment meet, so it is the
 * one place that must not improvise: all arithmetic and all invariants come
 * from `buildCheckoutDraft` in the domain package.
 *
 * Order creation runs inside a single transaction that does, in order:
 * claim the idempotency key, load the store and products, reserve stock
 * atomically, insert the order with its lines, and record live attribution.
 * Any throw rolls the whole thing back — there is no state in which stock is
 * gone but no order exists.
 *
 * The payment intent is created *after* the commit on purpose: it talks to an
 * external system, and holding a database transaction open across a network
 * call to a payment provider is how you get lock storms in production.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(ORDER_TRANSACTION_RUNNER) private readonly transactions: OrderTransactionRunner,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly storeService: StoreService,
    private readonly liveService: LiveService,
  ) {}

  // --- Preview -------------------------------------------------------------

  async preview(storeId: StoreId, input: CheckoutPreviewRequest): Promise<CheckoutPreviewDto> {
    const store = await this.storeService.requireById(storeId);
    const market = getMarket(store.country);

    const deliveryMethod = market.delivery.find((method) => method.id === input.deliveryMethodId);
    if (!deliveryMethod) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ese método de entrega no está disponible.',
      });
    }

    const products = await this.products.listByIds(
      input.lines.map((line) => asProductId(line.productId)),
    );
    const lines = this.resolveLines(store, input.lines, products);

    // The preview skips the address requirement: the buyer has not filled it
    // in yet, and blocking the price on it would make the form feel broken.
    const draft = buildCheckoutDraft({
      store,
      lines,
      deliveryMethod,
      paymentMethod: market.payment[0]!,
      installments: input.installments,
      address: null,
      tax: market.tax,
      enforceAddress: false,
    });

    return {
      store: toStoreSummaryDto(store),
      items: draft.items.map((item) => ({
        productId: String(item.productId),
        variantId: String(item.variantId),
        title: item.titleSnapshot,
        variantLabel: item.variantLabelSnapshot,
        imageUrl: item.imageUrlSnapshot,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        subtotalMinor: item.subtotalMinor,
        taxCategory: item.taxCategory,
        taxRateBps: item.taxRateBps,
        taxAmountMinor: item.taxAmountMinor,
      })),
      currency: draft.totals.currency,
      subtotalMinor: draft.totals.subtotalMinor,
      shippingMinor: draft.totals.shippingMinor,
      discountMinor: draft.totals.discountMinor,
      taxMinor: draft.totals.taxMinor,
      totalMinor: draft.totals.totalMinor,
      taxLabel: draft.totals.tax.label,
      tax: draft.totals.tax,
      installmentPreview:
        input.installments > 1
          ? installmentPreview(draft.totals.totalMinor, input.installments)
          : null,
    };
  }

  // --- Order creation -------------------------------------------------------

  /**
   * Creates an order exactly once for a given idempotency key.
   *
   * `idempotencyKey` is required by the controller. Two identical requests —
   * a double tap, a browser retry, a provider replay — produce one order and
   * one stock movement; the second call returns the first one's result.
   */
  async createOrder(
    buyerId: UserId,
    storeId: StoreId,
    input: CreateOrderRequest,
    idempotencyKey: string,
  ): Promise<OrderDto> {
    const key = assertIdempotencyKey(idempotencyKey);
    const scope = idempotencyScope(CREATE_ORDER_OPERATION, String(buyerId));
    const requestHash = fingerprintRequest({ storeId: String(storeId), ...input });

    const outcome = await this.transactions.run(async (tx) =>
      this.createInsideTransaction(tx, { buyerId, storeId, input, key, scope, requestHash }),
    );

    if (outcome.kind === 'replayed') {
      const existing = await this.orders.findById(outcome.orderId);
      /* c8 ignore next 3 -- the key and the order commit together. */
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
      }
      return toOrderDto(existing, outcome.store);
    }

    // Outside the transaction: an external call must not hold row locks.
    const order = await this.attachPaymentIntent(outcome.order, outcome.store);

    // Also outside: the seller console should learn about the sale, but a
    // socket nobody is listening on must never fail a purchase that committed.
    await this.announceSale(order, outcome.store);

    return toOrderDto(order, outcome.store);
  }

  private async createInsideTransaction(
    tx: OrderTransaction,
    context: {
      buyerId: UserId;
      storeId: StoreId;
      input: CreateOrderRequest;
      key: string;
      scope: string;
      requestHash: string;
    },
  ): Promise<
    | { kind: 'created'; order: Order; store: Store }
    | { kind: 'replayed'; orderId: OrderId; store: Store }
  > {
    const { buyerId, storeId, input, key, scope, requestHash } = context;

    const claim = await tx.claimIdempotency({
      scope,
      key,
      userId: buyerId,
      requestHash,
      createdAt: this.clock.now(),
    });

    if (claim.status === 'conflict') {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Esa clave de idempotencia ya se usó con otro pedido.',
      });
    }

    const store = await tx.loadStore(storeId);
    if (!store) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tienda inexistente.' });

    if (claim.status === 'replayed') {
      /* c8 ignore next 6 -- only reachable if a claim outlived its order. */
      if (!claim.orderId) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Ese pedido todavía se está procesando. Probá de nuevo en unos segundos.',
        });
      }
      return { kind: 'replayed', orderId: claim.orderId, store };
    }

    const market = getMarket(store.country);
    const deliveryMethod = market.delivery.find((method) => method.id === input.deliveryMethodId);
    const paymentMethod = market.payment.find((method) => method.id === input.paymentMethodId);
    if (!deliveryMethod || !paymentMethod) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Revisá el método de entrega y el medio de pago.',
      });
    }

    // Read inside the transaction so prices cannot shift under the order.
    const products = await tx.loadProducts(input.lines.map((line) => asProductId(line.productId)));
    const lines = this.resolveLines(store, input.lines, products);

    const draft = buildCheckoutDraft({
      store,
      lines,
      deliveryMethod,
      paymentMethod,
      installments: input.installments,
      address: input.address ? { ...input.address, id: null } : null,
      tax: market.tax,
      // The atomic reservation below is the authority on stock, not a read.
      skipStockCheck: true,
    });

    const reservationLines: StockReservationLine[] = draft.reservations.map((reservation) => ({
      productId: reservation.product.id,
      variantId: reservation.variant.id,
      quantity: reservation.quantity,
    }));

    const reserved = await tx.reserveStock(reservationLines);
    if (!reserved.ok) {
      // Throwing rolls back the claim too, so a later retry with the same key
      // is allowed once the seller restocks.
      throw stockShortfallError(reserved.shortfall);
    }

    const orderId = asOrderId(this.ids.generate('ord'));
    const now = this.clock.now();

    const order: Order = {
      id: orderId,
      code: buildOrderCode(String(orderId)),
      buyerId,
      storeId: store.id,
      liveSessionId: input.liveSessionId ? asLiveSessionId(input.liveSessionId) : null,
      items: draft.items,
      currency: draft.totals.currency,
      subtotalMinor: draft.totals.subtotalMinor,
      shippingMinor: draft.totals.shippingMinor,
      discountMinor: draft.totals.discountMinor,
      totalMinor: draft.totals.totalMinor,
      taxMinor: draft.totals.taxMinor,
      tax: draft.totals.tax,
      status: 'pending_payment',
      payment: draft.payment,
      delivery: draft.delivery,
      buyerNote: input.buyerNote,
      timeline: [{ status: 'pending_payment', at: now, note: null }],
      createdAt: now,
      updatedAt: now,
    };

    await tx.insertOrder(order);
    await tx.attachIdempotencyResult(scope, key, orderId);

    if (order.liveSessionId) {
      await tx.recordLiveSale(
        order.liveSessionId,
        draft.reservations.map((reservation) => ({
          productId: reservation.product.id,
          quantity: reservation.quantity,
        })),
      );
    }

    return { kind: 'created', order, store };
  }

  /**
   * Tells the broadcast console about a sale, and everyone else that something
   * moved.
   *
   * Two different events on purpose. The seller room gets units, revenue and
   * the order id, because that is their own shop. The public room gets only a
   * product title - no buyer, no amount, no order id - so the social nudge
   * cannot leak who bought what.
   */
  private async announceSale(order: Order, store: Store): Promise<void> {
    if (!order.liveSessionId) return;

    try {
      const stats = await this.liveService.stats(order.liveSessionId);
      await this.realtime.orderCreated(store.id, {
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
      // Nothing in here is allowed to undo a committed order.
    }
  }

  /**
   * Registers the intent with the payment provider and stores its reference.
   *
   * A failure here leaves a valid `pending_payment` order the buyer can retry,
   * which is strictly better than rolling back a purchase because a third
   * party had a bad minute.
   */
  private async attachPaymentIntent(order: Order, store: Store): Promise<Order> {
    try {
      const intent = await this.payments.createIntent({
        orderId: order.id,
        amountMinor: order.totalMinor,
        currency: order.currency,
        installments: order.payment.installments,
        description: `${store.name} — ${order.items.length} artículo(s)`,
      });

      return this.orders.update({
        ...order,
        payment: { ...order.payment, reference: intent.reference },
        updatedAt: this.clock.now(),
      });
    } catch {
      return order;
    }
  }

  // --- Payment settlement -----------------------------------------------------

  /**
   * Settles the simulated payment. When Mercado Pago lands this becomes a
   * webhook handler calling the same code below the provider call, and the
   * webhook's own delivery id becomes the idempotency key.
   */
  async confirmPayment(
    buyerId: UserId,
    orderId: OrderId,
    outcome: 'approved' | 'rejected',
  ): Promise<OrderDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
    }
    const store = await this.storeService.requireById(order.storeId);

    // Confirming twice is a no-op, not a second payment.
    if (order.status !== 'pending_payment') return toOrderDto(order, store);

    const intent = await this.payments.confirm({
      reference: order.payment.reference ?? String(order.id),
      outcome,
    });
    const now = this.clock.now();

    if (intent.status !== 'approved') {
      const failed = await this.orders.update({
        ...order,
        payment: { ...order.payment, status: 'rejected' },
        updatedAt: now,
      });
      return toOrderDto(failed, store);
    }

    const paid = await this.orders.update({
      ...order,
      status: 'paid',
      payment: { ...order.payment, status: 'approved', reference: intent.reference, paidAt: now },
      timeline: [...order.timeline, { status: 'paid', at: now, note: null }],
      updatedAt: now,
    });

    return toOrderDto(paid, store);
  }

  // --- Internals ----------------------------------------------------------------

  private resolveLines(
    store: Store,
    lines: CreateOrderRequest['lines'],
    products: readonly Product[],
  ): CheckoutLineRequest[] {
    const byId = new Map(products.map((product) => [String(product.id), product]));

    return lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product || product.storeId !== store.id) {
        throw new DomainError('PRODUCT_UNAVAILABLE', 'Product is not available in this store', {
          productId: line.productId,
        });
      }
      return {
        product,
        variantId: asVariantId(line.variantId),
        quantity: line.quantity,
      };
    });
  }
}
