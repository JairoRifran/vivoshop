import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Product, ProductId, ProductStatus, ProductVariant, Store, StoreId, UserId } from '@vivo/domain';
import { asProductId, asStoreId, asVariantId } from '@vivo/domain';
import type {
  CreateProductRequest,
  ProductDetailDto,
  ProductSummaryDto,
  UpdateProductRequest,
} from '@vivo/shared';
import { toProductDetailDto, toProductSummaryDto } from '../mappers/dto.mappers';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { ProductRepository, StoreRepository } from '../ports/repositories';
import { CLOCK, ID_GENERATOR, PRODUCT_REPOSITORY, STORE_REPOSITORY } from '../ports/tokens';
import { StoreService } from './store.service';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly storeService: StoreService,
  ) {}

  /**
   * Resolves the owning store for a batch of products in a single round trip.
   * Every list endpoint goes through here, which is what keeps the mappers
   * free of repository access.
   */
  private async withStores(products: Product[]): Promise<ProductSummaryDto[]> {
    const storeIds = [...new Set(products.map((product) => String(product.storeId)))].map(asStoreId);
    const stores = await this.stores.listByIds(storeIds);
    const byId = new Map(stores.map((store) => [String(store.id), store]));

    return products
      .map((product) => {
        const store = byId.get(String(product.storeId));
        return store ? toProductSummaryDto(product, store) : null;
      })
      .filter((dto): dto is ProductSummaryDto => dto !== null);
  }

  async listPublic(query: { search?: string; limit?: number } = {}): Promise<ProductSummaryDto[]> {
    const products = await this.products.list({ ...query, status: 'active' });
    return this.withStores(products);
  }

  async listByStoreSlug(slug: string, limit?: number): Promise<ProductSummaryDto[]> {
    const store = await this.stores.findBySlug(slug);
    if (!store) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tienda inexistente.' });

    const products = await this.products.list({ storeId: store.id, status: 'active', limit });
    return products.map((product) => toProductSummaryDto(product, store));
  }

  async requireProduct(id: ProductId): Promise<{ product: Product; store: Store }> {
    const product = await this.products.findById(id);
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Producto inexistente.' });
    }
    const store = await this.storeService.requireById(product.storeId);
    return { product, store };
  }

  async detail(id: ProductId): Promise<ProductDetailDto> {
    const { product, store } = await this.requireProduct(id);
    return toProductDetailDto(product, store);
  }

  // --- Seller surface ----------------------------------------------------------

  async listForSeller(
    ownerId: UserId,
    query: { search?: string; status?: ProductStatus } = {},
  ): Promise<ProductSummaryDto[]> {
    const store = await this.storeService.requireOwned(ownerId);
    const products = await this.products.list({ storeId: store.id, ...query });
    return products.map((product) => toProductSummaryDto(product, store));
  }

  async create(ownerId: UserId, input: CreateProductRequest): Promise<ProductDetailDto> {
    const store = await this.storeService.requireOwned(ownerId);
    const now = this.clock.now();
    const productId = asProductId(this.ids.generate('prd'));

    const product: Product = {
      id: productId,
      storeId: store.id,
      title: input.title.trim(),
      description: input.description ?? '',
      basePriceMinor: input.basePriceMinor,
      compareAtPriceMinor: input.compareAtPriceMinor,
      currency: store.currency,
      images: this.resolveImages(input.images, String(productId), input.title),
      options: input.options.map((option) => ({ name: option.name, values: [...option.values] })),
      variants: this.buildVariants(input.variants, String(productId)),
      status: input.status,
      // Null means the market default; the seller UI does not expose this yet.
      taxCategory: null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.products.create(product);
    return toProductDetailDto(created, store);
  }

  async update(
    ownerId: UserId,
    id: ProductId,
    input: UpdateProductRequest,
  ): Promise<ProductDetailDto> {
    const store = await this.storeService.requireOwned(ownerId);
    const { product } = await this.requireOwnedProduct(store.id, id);

    const updated = await this.products.update({
      ...product,
      title: input.title?.trim() ?? product.title,
      description: input.description ?? product.description,
      basePriceMinor: input.basePriceMinor ?? product.basePriceMinor,
      compareAtPriceMinor:
        input.compareAtPriceMinor === undefined
          ? product.compareAtPriceMinor
          : input.compareAtPriceMinor,
      images: input.images
        ? this.resolveImages(input.images, String(product.id), input.title ?? product.title)
        : product.images,
      options: input.options
        ? input.options.map((option) => ({ name: option.name, values: [...option.values] }))
        : product.options,
      variants: input.variants
        ? this.buildVariants(input.variants, String(product.id))
        : product.variants,
      status: input.status ?? product.status,
      updatedAt: this.clock.now(),
    });

    return toProductDetailDto(updated, store);
  }

  /** Publish/unpublish from the product list, the seller's most frequent action. */
  async toggleStatus(ownerId: UserId, id: ProductId): Promise<ProductDetailDto> {
    const store = await this.storeService.requireOwned(ownerId);
    const { product } = await this.requireOwnedProduct(store.id, id);

    const updated = await this.products.update({
      ...product,
      status: product.status === 'active' ? 'paused' : 'active',
      updatedAt: this.clock.now(),
    });

    return toProductDetailDto(updated, store);
  }

  private async requireOwnedProduct(
    storeId: StoreId,
    id: ProductId,
  ): Promise<{ product: Product }> {
    const product = await this.products.findById(id);
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Producto inexistente.' });
    }
    return { product };
  }

  /**
   * M01 has no image upload, so a product created from the seller UI gets
   * deterministic generated imagery keyed by its id. When StorageProvider
   * starts returning real URLs, they arrive through `input.images` and this
   * fallback simply stops being used.
   */
  private resolveImages(
    images: CreateProductRequest['images'] | undefined,
    productId: string,
    title: string,
  ) {
    if (images && images.length > 0) {
      return images.map((image, index) => ({
        url: image.url,
        alt: image.alt || `${title} — foto ${index + 1}`,
      }));
    }
    return [
      { url: `/media/product/${productId}`, alt: `${title} — foto 1` },
      { url: `/media/product/${productId}-2`, alt: `${title} — foto 2` },
    ];
  }

  private buildVariants(
    variants: NonNullable<CreateProductRequest['variants']>,
    productId: string,
  ): ProductVariant[] {
    return variants.map((variant, index) => ({
      id: asVariantId(variant.id ?? `${productId}-v${index + 1}`),
      optionValues: { ...variant.optionValues },
      sku: variant.sku,
      priceMinor: variant.priceMinor,
      stock: variant.stock,
      active: variant.active,
    }));
  }
}
