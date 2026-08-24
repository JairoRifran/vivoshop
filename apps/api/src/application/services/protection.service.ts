import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Dispute, Order, OrderId, UserId } from '@vivo/domain';
import {
  assertProtectionTransition,
  canPromiseProtection,
  canTransitionOrder,
  orderDeliveredAt,
} from '@vivo/domain';
import type { OpenDisputeRequest } from '@vivo/shared';
import type { Clock } from '../ports/infrastructure';
import type { DisputeRepository, PaymentProviderPort } from '../ports/payments';
import { DISPUTE_REPOSITORY, PAYMENT_PROVIDER_PORT } from '../ports/payments';
import type { OrderRepository } from '../ports/repositories';
import { CLOCK, ORDER_REPOSITORY } from '../ports/tokens';

/**
 * Compra Protegida, del lado del comprador.
 *
 * Dos operaciones y nada más: dar por recibida la compra, y reclamar. Es
 * deliberadamente poco. El circuito completo de un reclamo —evidencia, plazos
 * de respuesta, decisión— es trabajo posterior; lo que queda resuelto ahora es
 * lo único que sería imposible agregar después sin migrar pedidos: que un
 * reclamo pueda congelar una liquidación, y que completar un pedido no
 * signifique que la plata se liberó.
 *
 * VivoShop no custodia fondos. No hay wallet, no hay escrow propio. Si el
 * proveedor no retiene, la protección no se promete — se ve en
 * `canPromiseProtection`, no en un texto de marketing.
 */
@Injectable()
export class ProtectionService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(DISPUTE_REPOSITORY) private readonly disputes: DisputeRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * "Recibí mi compra".
   *
   * Cierra la operación comercial y **no** libera dinero: quién libera es el
   * proveedor, y `SettlementStatus` puede seguir en `pending_release` con el
   * pedido ya `completed`. Son dos ejes distintos.
   */
  async confirmReceipt(buyerId: UserId, orderId: OrderId): Promise<Order> {
    const order = await this.requireOwn(buyerId, orderId);

    if (!canTransitionOrder(order.status, 'completed')) {
      throw new ConflictException({
        code: 'INVALID_ORDER_TRANSITION',
        message: 'Todavía no se puede dar por recibida esta compra.',
      });
    }
    if (order.protection === 'disputed') {
      throw new ConflictException({
        code: 'INVALID_PROTECTION_TRANSITION',
        message: 'La compra tiene un reclamo abierto.',
      });
    }

    const now = this.clock.now();
    return this.orders.update({
      ...order,
      status: 'completed',
      protection: order.protection === 'protected' ? 'resolved' : order.protection,
      timeline: [...order.timeline, { status: 'completed', at: now, note: null }],
      updatedAt: now,
    });
  }

  /**
   * Abre un reclamo.
   *
   * Solo sobre una compra protegida: sin retención no hay nada que congelar, y
   * ofrecer el botón igual sería prometer un mecanismo que no existe. Con un
   * proveedor que solo reembolsa, el camino es la devolución, no este.
   */
  async openDispute(
    buyerId: UserId,
    orderId: OrderId,
    input: OpenDisputeRequest,
  ): Promise<Dispute> {
    const order = await this.requireOwn(buyerId, orderId);

    if (!canPromiseProtection(this.provider.capabilities())) {
      throw new BadRequestException({
        code: 'PAYMENT_UNAVAILABLE',
        message: 'Esta compra no tiene reclamos disponibles. Escribinos y lo vemos.',
      });
    }

    const existing = await this.disputes.findByOrderId(orderId);
    if (existing && existing.status === 'open') return existing;

    assertProtectionTransition(order.protection, 'disputed');

    const now = this.clock.now();
    const dispute: Dispute = {
      orderId,
      openedBy: buyerId,
      reason: input.reason,
      status: 'open',
      detail: input.detail,
      openedAt: now,
      resolvedAt: null,
    };

    await this.orders.update({ ...order, protection: 'disputed', updatedAt: now });
    return existing ? this.disputes.update(dispute) : this.disputes.create(dispute);
  }

  async disputeFor(orderId: OrderId): Promise<Dispute | null> {
    return this.disputes.findByOrderId(orderId);
  }

  /** Cuándo se completa sola una compra que el comprador no confirmó. */
  autoCompleteInput(order: Order) {
    return { deliveredAt: orderDeliveredAt(order), protection: order.protection };
  }

  private async requireOwn(buyerId: UserId, orderId: OrderId): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido inexistente.' });
    }
    return order;
  }
}
