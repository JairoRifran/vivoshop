import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { asProductId, asStoreId, type StoreCategory } from '@vivo/domain';
import { z } from 'zod';
import {
  createStoreRequestSchema,
  type CreateStoreRequest,
  type ProductDetailDto,
  type ProductSummaryDto,
  type StoreDetailDto,
  type StoreSummaryDto,
} from '@vivo/shared';
import { CatalogService } from '../application/services/catalog.service';
import { StoreService } from '../application/services/store.service';
import { OptionalAuth, Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoreService,
    private readonly catalog: CatalogService,
  ) {}

  @OptionalAuth()
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<StoreSummaryDto[]> {
    return this.stores.list(
      {
        ...(category ? { category: category as StoreCategory } : {}),
        ...(search ? { search } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
      },
      user?.id ?? null,
    );
  }

  /** Placed before `:slug` so the literal path is not swallowed by the param. */
  @Get('following')
  following(@CurrentUser() user: AuthenticatedUser | null): Promise<StoreSummaryDto[]> {
    return this.stores.following(requireUser(user).id);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser | null): Promise<StoreDetailDto | null> {
    return this.stores.mine(requireUser(user).id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(createStoreRequestSchema)) body: CreateStoreRequest,
  ): Promise<StoreDetailDto> {
    return this.stores.create(requireUser(user).id, body);
  }

  @OptionalAuth()
  @Get(':slug')
  bySlug(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<StoreDetailDto> {
    return this.stores.bySlug(slug, user?.id ?? null);
  }

  @Public()
  @Get(':slug/products')
  products(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
  ): Promise<ProductSummaryDto[]> {
    return this.catalog.listByStoreSlug(slug, limit ? Number(limit) : undefined);
  }

  @Post(':storeId/follow')
  follow(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('storeId') storeId: string,
  ): Promise<{ following: boolean }> {
    return this.stores.follow(requireUser(user).id, asStoreId(storeId));
  }

  /**
   * La preferencia de aviso, separada de seguir.
   *
   * Seguir una tienda y querer que te interrumpan cuando transmite son dos
   * decisiones distintas, y esta ruta existe para poder cambiar la segunda sin
   * tocar la primera. Sin ella, apagar los avisos de una tienda obligaba a
   * dejar de seguirla.
   */
  @Put(':storeId/follow/notifications')
  setLiveNotifications(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('storeId') storeId: string,
    @Body(zodPipe(z.object({ notifyOnLive: z.boolean() })))
    body: { notifyOnLive: boolean },
  ): Promise<{ notifyOnLive: boolean }> {
    return this.stores.setLiveNotifications(
      requireUser(user).id,
      asStoreId(storeId),
      body.notifyOnLive,
    );
  }

  @Delete(':storeId/follow')
  unfollow(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('storeId') storeId: string,
  ): Promise<{ following: boolean }> {
    return this.stores.unfollow(requireUser(user).id, asStoreId(storeId));
  }
}

@Controller('products')
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  list(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<ProductSummaryDto[]> {
    return this.catalog.listPublic({
      ...(search ? { search } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Public()
  @Get(':id')
  detail(@Param('id') id: string): Promise<ProductDetailDto> {
    return this.catalog.detail(asProductId(id));
  }
}
