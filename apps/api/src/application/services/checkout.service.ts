import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
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
  initialProtection,
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
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { PaymentProviderPort } from '../ports/payments';
import { PAYMENT_PROVIDER_PORT } from '../ports/payments';
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
  PRODUCT_REPOSITORY,
} from '../ports/tokens';
import { PaymentService } from './payment.service';
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
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(ORDER_TRANSACTION_RUNNER) private readonly transactions: OrderTransactionRunner,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly storeService: StoreService,
    private readonly payments: PaymentService,
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

    // Fuera de la transacción: hablar con un tercero con locks tomados es
    // cómo se consiguen tormentas de bloqueos en producción.
    //
    // Y nada de anunciar la venta acá. Un pedido creado es alguien que apretó
    // "comprar"; la venta se canta cuando el pago se aprueba, y de eso se
    // ocupa `PaymentService` desde el webhook.
    const checkoutUrl = await this.openPayment(outcome.order, outcome.store);

    return toOrderDto(outcome.order, outcome.store, checkoutUrl);
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
      protection: initialProtection(this.provider.capabilities()),
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
   * Abre el cobro y devuelve a dónde ir a pagar.
   *
   * Un fallo acá deja un pedido `pending_payment` válido que el comprador
   * puede reintentar, que es estrictamente mejor que deshacer una compra
   * porque un tercero tuvo un mal minuto. El pedido ya está commiteado; esto
   * es lo único que puede faltar.
   */
  private async openPayment(order: Order, store: Store): Promise<string | null> {
    try {
      const payment = await this.payments.startForOrder(order, store);
      return payment.checkoutUrl;
    } catch (error) {
      this.logger.warn(`No se pudo abrir el cobro del pedido ${order.id}: ${String(error)}`);
      return null;
    }
  }

  /**
   * Reintenta el cobro de un pedido que quedó sin pagar.
   *
   * Reutiliza el cobro abierto si lo hay: apretar "pagar" dos veces no crea
   * dos cobros.
   */
  async startPayment(buyerId: UserId, orderId: OrderId) {
    const order = await this.orders.findById(orderId);
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
    }
    if (order.status !== 'pending_payment') {
      throw new ConflictException({
        code: 'INVALID_ORDER_TRANSITION',
        message: 'Este pedido ya no está esperando el pago.',
      });
    }

    const store = await this.storeService.requireById(order.storeId);
    return this.payments.startForOrder(order, store);
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
