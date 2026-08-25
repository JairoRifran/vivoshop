import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { asOrderId, asStoreId, type OrderStatus } from '@vivo/domain';
import {
  checkoutPreviewRequestSchema,
  createOrderRequestSchema,
  openDisputeRequestSchema,
  simulatePaymentRequestSchema,
  type CheckoutPreviewDto,
  type CheckoutPreviewRequest,
  type CreateOrderRequest,
  type DisputeDto,
  type OpenDisputeRequest,
  type OrderDto,
  type PaymentDto,
  type SimulatePaymentRequest,
} from '@vivo/shared';
import { toDisputeDto, toOrderDto, toPaymentDto } from '../application/mappers/dto.mappers';
import { CheckoutService } from '../application/services/checkout.service';
import { OrderService } from '../application/services/order.service';
import { PaymentService } from '../application/services/payment.service';
import { ProtectionService } from '../application/services/protection.service';
import { StoreService } from '../application/services/store.service';
import {
  OptionalAuth,
  Public,
  requireUser,
  type AuthenticatedUser,
} from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * Public so the price a buyer sees before signing in is the real one. Only
   * placing the order requires an account.
   */
  @Public()
  @OptionalAuth()
  @Post(':storeId/preview')
  preview(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('storeId') storeId: string,
    @Body(zodPipe(checkoutPreviewRequestSchema)) body: CheckoutPreviewRequest,
  ): Promise<CheckoutPreviewDto> {
    return this.checkout.preview(asStoreId(storeId), body, user?.id ?? null);
  }

  /**
   * Requires an `Idempotency-Key` header.
   *
   * Mandatory rather than optional: a double tap on a phone with a bad
   * connection is the normal case, not the edge case, and an optional header
   * is one a client forgets exactly once — in the place where forgetting
   * charges someone twice.
   */
  @Post(':storeId/orders')
  create(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('storeId') storeId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(zodPipe(createOrderRequestSchema)) body: CreateOrderRequest,
  ): Promise<OrderDto> {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Falta la cabecera Idempotency-Key.',
      });
    }
    return this.checkout.createOrder(
      requireUser(user).id,
      asStoreId(storeId),
      body,
      idempotencyKey,
    );
  }
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrderService,
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentService,
    private readonly protection: ProtectionService,
    private readonly stores: StoreService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query('status') status?: string,
  ): Promise<OrderDto[]> {
    return this.orders.listForBuyer(requireUser(user).id, status as OrderStatus | undefined);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<OrderDto> {
    return this.orders.detailForBuyer(requireUser(user).id, asOrderId(id));
  }

  /**
   * Abre (o recupera) el cobro y devuelve a donde ir a pagar.
   *
   * No confirma nada. El metodo anterior se llamaba `confirmPayment` y esa
   * palabra era exactamente el error: el navegador no puede decidir si se
   * cobro. Quien decide es el webhook del proveedor.
   */
  @Post(':id/payment')
  async pay(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<PaymentDto> {
    const payment = await this.checkout.startPayment(requireUser(user).id, asOrderId(id));
    return toPaymentDto(payment);
  }

  /**
   * Resuelve un cobro simulado.
   *
   * Solo existe con el proveedor de desarrollo, y el propio servicio lo
   * rechaza con cualquier otro. Con Mercado Pago esto seria un boton publico
   * para marcar pedidos como pagos.
   */
  @Post(':id/payment/simulate')
  async simulate(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(simulatePaymentRequestSchema)) body: SimulatePaymentRequest,
  ): Promise<OrderDto> {
    const buyerId = requireUser(user).id;
    // Reutiliza el cobro abierto si ya existe: apretar dos veces no crea dos.
    const payment = await this.checkout.startPayment(buyerId, asOrderId(id));
    await this.payments.simulate(payment.providerIntentId ?? '', body.outcome);
    return this.orders.detailForBuyer(buyerId, asOrderId(id));
  }

  /** "Recibi mi compra". Cierra la operacion; no libera el dinero. */
  @Post(':id/receipt')
  async confirmReceipt(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<OrderDto> {
    const order = await this.protection.confirmReceipt(requireUser(user).id, asOrderId(id));
    return toOrderDto(order, await this.stores.requireById(order.storeId));
  }

  @Post(':id/dispute')
  async openDispute(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(openDisputeRequestSchema)) body: OpenDisputeRequest,
  ): Promise<DisputeDto> {
    return toDisputeDto(
      await this.protection.openDispute(requireUser(user).id, asOrderId(id), body),
    );
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<OrderDto> {
    return this.orders.cancelAsBuyer(requireUser(user).id, asOrderId(id));
  }
}
