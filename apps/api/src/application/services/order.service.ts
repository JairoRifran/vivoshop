import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Order, OrderId, OrderStatus, Store, UserId } from '@vivo/domain';
import { assertOrderTransition, isOrderCancellableByBuyer, releaseStock } from '@vivo/domain';
import type { OrderDto } from '@vivo/shared';
import { toOrderDto } from '../mappers/dto.mappers';
import type { Clock, ShippingProvider } from '../ports/infrastructure';
import type { OrderRepository, ProductRepository, StoreRepository } from '../ports/repositories';
import {
  CLOCK,
  ORDER_REPOSITORY,
  PRODUCT_REPOSITORY,
  SHIPPING_PROVIDER,
  STORE_REPOSITORY,
} from '../ports/tokens';
import { StoreService } from './store.service';

@Injectable()
export class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(SHIPPING_PROVIDER) private readonly shipping: ShippingProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storeService: StoreService,
  ) {}

  // --- Buyer -----------------------------------------------------------------------

  async listForBuyer(buyerId: UserId, status?: OrderStatus): Promise<OrderDto[]> {
    const orders = await this.orders.list({ buyerId, ...(status ? { status } : {}) });
    return this.withStores(orders);
  }

  async detailForBuyer(buyerId: UserId, id: OrderId): Promise<OrderDto> {
    const order = await this.requireOrder(id);
    if (order.buyerId !== buyerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
    }
    return toOrderDto(order, await this.storeService.requireById(order.storeId));
  }

  async cancelAsBuyer(buyerId: UserId, id: OrderId): Promise<OrderDto> {
    const order = await this.requireOrder(id);
    if (order.buyerId !== buyerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
    }
    if (!isOrderCancellableByBuyer(order)) {
      throw new ForbiddenException({
        code: 'INVALID_ORDER_TRANSITION',
        message: 'El pedido ya está en preparación y no se puede cancelar desde acá.',
      });
    }

    return this.transition(order, 'cancelled', 'Cancelado por el comprador');
  }

  // --- Seller ------------------------------------------------------------------------

  async listForSeller(ownerId: UserId, status?: OrderStatus): Promise<OrderDto[]> {
    const store = await this.storeService.requireOwned(ownerId);
    const orders = await this.orders.list({ storeId: store.id, ...(status ? { status } : {}) });
    return orders.map((order) => toOrderDto(order, store));
  }

  async updateStatus(
    ownerId: UserId,
    id: OrderId,
    status: OrderStatus,
    note: string | null,
  ): Promise<OrderDto> {
    const store = await this.storeService.requireOwned(ownerId);
    const order = await this.requireOrder(id);

    if (order.storeId !== store.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Ese pedido no pertenece a tu tienda.',
      });
    }

    // The domain owns which moves are legal; this service only asks.
    assertOrderTransition(order.status, status);
    return this.transition(order, status, note, store);
  }

  // --- Internals ----------------------------------------------------------------------

  private async requireOrder(id: OrderId): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
    return order;
  }

  private async transition(
    order: Order,
    status: OrderStatus,
    note: string | null,
    knownStore?: Store,
  ): Promise<OrderDto> {
    const now = this.clock.now();
    const store = knownStore ?? (await this.storeService.requireById(order.storeId));

    let delivery = order.delivery;
    if (status === 'shipped' && delivery.kind === 'shipping' && !delivery.trackingCode) {
      const { trackingCode } = await this.shipping.createShipment(order);
      delivery = { ...delivery, trackingCode };
    }

    if (status === 'cancelled') await this.releaseReservedStock(order);

    const updated = await this.orders.update({
      ...order,
      status,
      delivery,
      payment:
        status === 'cancelled' && order.payment.status === 'pending'
          ? { ...order.payment, status: 'rejected' }
          : order.payment,
      timeline: [...order.timeline, { status, at: now, note }],
      updatedAt: now,
    });

    return toOrderDto(updated, store);
  }

  /** Cancelling puts the units back on the shelf. */
  private async releaseReservedStock(order: Order): Promise<void> {
    for (const item of order.items) {
      const product = await this.products.findById(item.productId);
      if (!product) continue;

      await this.products.update({
        ...product,
        variants: product.variants.map((variant) =>
          String(variant.id) === String(item.variantId)
            ? releaseStock(variant, item.quantity)
            : variant,
        ),
        updatedAt: this.clock.now(),
      });
    }
  }

  private async withStores(orders: Order[]): Promise<OrderDto[]> {
    const storeIds = [...new Set(orders.map((order) => order.storeId))];
    const stores = await this.stores.listByIds(storeIds);
    const byId = new Map(stores.map((store) => [String(store.id), store]));

    return orders
      .map((order) => {
        const store = byId.get(String(order.storeId));
        return store ? toOrderDto(order, store) : null;
      })
      .filter((dto): dto is OrderDto => dto !== null);
  }
}
