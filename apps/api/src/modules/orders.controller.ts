import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { asOrderId, asStoreId, type OrderStatus } from '@vivo/domain';
import {
  checkoutPreviewRequestSchema,
  confirmPaymentRequestSchema,
  createOrderRequestSchema,
  type CheckoutPreviewDto,
  type CheckoutPreviewRequest,
  type ConfirmPaymentRequest,
  type CreateOrderRequest,
  type OrderDto,
} from '@vivo/shared';
import { CheckoutService } from '../application/services/checkout.service';
import { OrderService } from '../application/services/order.service';
import { Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * Public so the price a buyer sees before signing in is the real one. Only
   * placing the order requires an account.
   */
  @Public()
  @Post(':storeId/preview')
  preview(
    @Param('storeId') storeId: string,
    @Body(zodPipe(checkoutPreviewRequestSchema)) body: CheckoutPreviewRequest,
  ): Promise<CheckoutPreviewDto> {
    return this.checkout.preview(asStoreId(storeId), body);
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
   * Settles the simulated payment. Replaced in M02 by a provider webhook plus
   * a client-side return URL; the order state machine below it does not move.
   */
  @Post(':id/payment')
  pay(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(confirmPaymentRequestSchema)) body: ConfirmPaymentRequest,
  ): Promise<OrderDto> {
    return this.checkout.confirmPayment(requireUser(user).id, asOrderId(id), body.outcome);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<OrderDto> {
    return this.orders.cancelAsBuyer(requireUser(user).id, asOrderId(id));
  }
}
