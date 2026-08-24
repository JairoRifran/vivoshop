import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  asLiveSessionId,
  asOrderId,
  asProductId,
  type OrderStatus,
  type ProductStatus,
} from '@vivo/domain';
import {
  createLiveRequestSchema,
  createProductRequestSchema,
  featureProductRequestSchema,
  updateOrderStatusRequestSchema,
  updateProductRequestSchema,
  updateStoreRequestSchema,
  type CreateLiveRequest,
  type CreateProductRequest,
  type FeatureProductRequest,
  type LiveDetailDto,
  type LiveSummaryDto,
  type OrderDto,
  type ProductDetailDto,
  type ProductSummaryDto,
  type SellerMetricsDto,
  type StoreDetailDto,
  type UpdateOrderStatusRequest,
  type UpdateProductRequest,
  type UpdateStoreRequest,
} from '@vivo/shared';
import { CatalogService } from '../application/services/catalog.service';
import { LiveService } from '../application/services/live.service';
import { OrderService } from '../application/services/order.service';
import { SellerService } from '../application/services/seller.service';
import { StoreService } from '../application/services/store.service';
import { Roles, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

/**
 * Everything behind Seller Center. `@Roles('seller')` applies to the whole
 * controller, so a buyer-only account gets a clean 403 rather than an
 * inconsistent partial view.
 */
@Roles('seller')
@Controller('seller')
export class SellerController {
  constructor(
    private readonly seller: SellerService,
    private readonly stores: StoreService,
    private readonly catalog: CatalogService,
    private readonly live: LiveService,
    private readonly orders: OrderService,
  ) {}

  @Get('metrics')
  metrics(@CurrentUser() user: AuthenticatedUser | null): Promise<SellerMetricsDto> {
    return this.seller.metrics(requireUser(user).id);
  }

  @Patch('store')
  updateStore(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(updateStoreRequestSchema)) body: UpdateStoreRequest,
  ): Promise<StoreDetailDto> {
    return this.stores.update(requireUser(user).id, body);
  }

  // --- Products -------------------------------------------------------------------

  @Get('products')
  listProducts(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ): Promise<ProductSummaryDto[]> {
    return this.catalog.listForSeller(requireUser(user).id, {
      ...(search ? { search } : {}),
      ...(status ? { status: status as ProductStatus } : {}),
    });
  }

  @Post('products')
  createProduct(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(createProductRequestSchema)) body: CreateProductRequest,
  ): Promise<ProductDetailDto> {
    return this.catalog.create(requireUser(user).id, body);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(updateProductRequestSchema)) body: UpdateProductRequest,
  ): Promise<ProductDetailDto> {
    return this.catalog.update(requireUser(user).id, asProductId(id), body);
  }

  @Post('products/:id/toggle')
  toggleProduct(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<ProductDetailDto> {
    return this.catalog.toggleStatus(requireUser(user).id, asProductId(id));
  }

  // --- Live sessions ----------------------------------------------------------------

  @Get('live')
  listLive(@CurrentUser() user: AuthenticatedUser | null): Promise<LiveSummaryDto[]> {
    return this.live.listForSeller(requireUser(user).id);
  }

  @Post('live')
  createLive(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(createLiveRequestSchema)) body: CreateLiveRequest,
  ): Promise<LiveDetailDto> {
    return this.live.create(requireUser(user).id, body);
  }

  /**
   * A publishing credential for the seller.
   *
   * Behind `@Roles('seller')` and re-checked in the service against store
   * ownership: holding the seller role is not the same as owning this session.
   */
  @Post('live/:id/broadcast-token')
  broadcastToken(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.live.issueBroadcasterCredentials(requireUser(user).id, asLiveSessionId(id));
  }

  @Post('live/:id/start')
  startLive(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<LiveDetailDto> {
    return this.live.start(requireUser(user).id, asLiveSessionId(id));
  }

  @Post('live/:id/end')
  endLive(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<LiveDetailDto> {
    return this.live.end(requireUser(user).id, asLiveSessionId(id));
  }

  @Post('live/:id/cancel')
  cancelLive(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<LiveDetailDto> {
    return this.live.cancel(requireUser(user).id, asLiveSessionId(id));
  }

  @Post('live/:id/feature')
  featureProduct(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(featureProductRequestSchema)) body: FeatureProductRequest,
  ): Promise<LiveDetailDto> {
    return this.live.feature(
      requireUser(user).id,
      asLiveSessionId(id),
      body.productId ? asProductId(body.productId) : null,
    );
  }

  // --- Orders ---------------------------------------------------------------------------

  @Get('orders')
  listOrders(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query('status') status?: string,
  ): Promise<OrderDto[]> {
    return this.orders.listForSeller(requireUser(user).id, status as OrderStatus | undefined);
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(updateOrderStatusRequestSchema)) body: UpdateOrderStatusRequest,
  ): Promise<OrderDto> {
    return this.orders.updateStatus(requireUser(user).id, asOrderId(id), body.status, body.note);
  }
}
