import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Store, StoreCategory, StoreId, UserId } from '@vivo/domain';
import { DEFAULT_STORE_SETTINGS, asStoreId, isValidSlug, toSlug } from '@vivo/domain';
import type {
  CreateStoreRequest,
  StoreDetailDto,
  StoreSummaryDto,
  UpdateStoreRequest,
} from '@vivo/shared';
import { getMarket } from '@vivo/config';
import { toStoreDetailDto, toStoreSummaryDto } from '../mappers/dto.mappers';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { FollowRepository, LiveRepository, StoreRepository } from '../ports/repositories';
import { CLOCK, FOLLOW_REPOSITORY, ID_GENERATOR, LIVE_REPOSITORY, STORE_REPOSITORY } from '../ports/tokens';
import { AuthService } from './auth.service';

@Injectable()
export class StoreService {
  constructor(
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(FOLLOW_REPOSITORY) private readonly follows: FollowRepository,
    @Inject(LIVE_REPOSITORY) private readonly live: LiveRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly auth: AuthService,
  ) {}

  async requireById(id: StoreId): Promise<Store> {
    const store = await this.stores.findById(id);
    if (!store) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tienda inexistente.' });
    return store;
  }

  async list(
    query: { category?: StoreCategory; search?: string; limit?: number },
    viewerId: UserId | null,
  ): Promise<StoreSummaryDto[]> {
    // Las dos consultas son independientes: cuáles son las tiendas y cuáles
    // están transmitiendo no dependen entre sí. En secuencia costaban dos
    // viajes a la base —unos 135 ms cada uno con la base en otra región—; en
    // paralelo, uno.
    const [stores, context] = await Promise.all([
      this.stores.list(query),
      this.decorationContext(viewerId),
    ]);
    return applyDecoration(stores, context, viewerId);
  }

  async bySlug(slug: string, viewerId: UserId | null): Promise<StoreDetailDto> {
    const store = await this.stores.findBySlug(slug);
    if (!store) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tienda inexistente.' });

    const [isFollowing, liveNow] = await Promise.all([
      viewerId ? this.follows.exists(viewerId, store.id) : Promise.resolve(false),
      this.live.list({ storeId: store.id, status: 'live', limit: 1 }),
    ]);

    return toStoreDetailDto(store, { isFollowing, isLiveNow: liveNow.length > 0 });
  }

  async mine(ownerId: UserId): Promise<StoreDetailDto | null> {
    const store = await this.stores.findByOwner(ownerId);
    return store ? toStoreDetailDto(store) : null;
  }

  async requireOwned(ownerId: UserId): Promise<Store> {
    const store = await this.stores.findByOwner(ownerId);
    if (!store) {
      throw new NotFoundException({
        code: 'STORE_REQUIRED',
        message: 'Activá el modo vendedor para continuar.',
      });
    }
    return store;
  }

  /**
   * Activating seller mode. One account can only own one store in M01, which
   * keeps ownership checks a single comparison; multi-store sellers are a
   * later change to this method and to `findByOwner`.
   */
  async create(ownerId: UserId, input: CreateStoreRequest): Promise<StoreDetailDto> {
    const existing = await this.stores.findByOwner(ownerId);
    if (existing) return toStoreDetailDto(existing);

    const slug = await this.resolveSlug(input.slug ?? input.name);
    const market = getMarket(input.country);
    const now = this.clock.now();

    const store: Store = {
      id: asStoreId(this.ids.generate('str')),
      ownerId,
      name: input.name.trim(),
      slug,
      description: input.description ?? '',
      category: input.category,
      logoUrl: `/media/store/${slug}`,
      coverUrl: `/media/cover/${slug}`,
      country: input.country,
      currency: market.currency,
      city: input.city?.trim() || null,
      reputation: { ratingBps: 0, reviewCount: 0, salesCount: 0 },
      followerCount: 0,
      // Una tienda nace sin verificar y así se queda hasta que su dueño
      // decida pedir el ✓, que es opcional. Nada de lo que sigue —cargar
      // productos, transmitir, vender, cobrar— depende de este campo.
      verification: 'unverified',
      status: 'active',
      settings: {
        ...DEFAULT_STORE_SETTINGS,
        deliveryMethodIds: market.delivery.map((method) => method.id),
      },
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.stores.create(store);
    await this.auth.grantSellerRole(ownerId);
    return toStoreDetailDto(created);
  }

  async update(ownerId: UserId, input: UpdateStoreRequest): Promise<StoreDetailDto> {
    const store = await this.requireOwned(ownerId);

    const updated = await this.stores.update({
      ...store,
      name: input.name?.trim() ?? store.name,
      description: input.description ?? store.description,
      category: input.category ?? store.category,
      city: input.city === undefined ? store.city : input.city,
      logoUrl: input.logoUrl === undefined ? store.logoUrl : input.logoUrl,
      coverUrl: input.coverUrl === undefined ? store.coverUrl : input.coverUrl,
      status: input.status ?? store.status,
      settings: {
        ...store.settings,
        deliveryMethodIds: input.deliveryMethodIds ?? store.settings.deliveryMethodIds,
        freeShippingThresholdMinor:
          input.freeShippingThresholdMinor === undefined
            ? store.settings.freeShippingThresholdMinor
            : input.freeShippingThresholdMinor,
        pickupInstructions:
          input.pickupInstructions === undefined
            ? store.settings.pickupInstructions
            : input.pickupInstructions,
      },
      updatedAt: this.clock.now(),
    });

    return toStoreDetailDto(updated);
  }

  async follow(userId: UserId, storeId: StoreId): Promise<{ following: boolean }> {
    const store = await this.requireById(storeId);
    if (await this.follows.exists(userId, storeId)) return { following: true };

    await this.follows.add({ userId, storeId, notifyOnLive: true, createdAt: this.clock.now() });
    await this.stores.update({
      ...store,
      followerCount: store.followerCount + 1,
      updatedAt: this.clock.now(),
    });
    return { following: true };
  }

  async unfollow(userId: UserId, storeId: StoreId): Promise<{ following: boolean }> {
    const store = await this.requireById(storeId);
    if (!(await this.follows.exists(userId, storeId))) return { following: false };

    await this.follows.remove(userId, storeId);
    await this.stores.update({
      ...store,
      followerCount: Math.max(0, store.followerCount - 1),
      updatedAt: this.clock.now(),
    });
    return { following: false };
  }

  async following(userId: UserId): Promise<StoreSummaryDto[]> {
    const ids = await this.follows.listStoreIds(userId);
    const stores = await this.stores.listByIds(ids);
    return this.decorate(stores, userId);
  }

  /** Adds the viewer-specific flags in one pass instead of per store. */
  private async decorate(stores: Store[], viewerId: UserId | null): Promise<StoreSummaryDto[]> {
    return applyDecoration(stores, await this.decorationContext(viewerId), viewerId);
  }

  /**
   * Lo que hace falta para decorar, y que no depende de qué tiendas sean.
   *
   * Separado del mapeo para que quien ya sabe eso —`list`— pueda pedirlo al
   * mismo tiempo que las tiendas en vez de después.
   */
  private async decorationContext(viewerId: UserId | null): Promise<DecorationContext> {
    const [followedIds, liveSessions] = await Promise.all([
      viewerId ? this.follows.listStoreIds(viewerId) : Promise.resolve([]),
      this.live.list({ status: 'live' }),
    ]);

    return {
      followed: new Set(followedIds.map(String)),
      liveStoreIds: new Set(liveSessions.map((session) => String(session.storeId))),
    };
  }

  private async resolveSlug(source: string): Promise<string> {
    const base = isValidSlug(source) ? source : toSlug(source);

    if (!(await this.stores.slugExists(base))) return base;

    for (let suffix = 2; suffix <= 30; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!(await this.stores.slugExists(candidate))) return candidate;
    }

    throw new ConflictException({
      code: 'SLUG_TAKEN',
      message: 'Ese nombre de tienda ya está en uso.',
    });
  }
}

interface DecorationContext {
  readonly followed: ReadonlySet<string>;
  readonly liveStoreIds: ReadonlySet<string>;
}

function applyDecoration(
  stores: Store[],
  context: DecorationContext,
  viewerId: UserId | null,
): StoreSummaryDto[] {
  return stores.map((store) =>
    toStoreSummaryDto(store, {
      ...(viewerId ? { isFollowing: context.followed.has(String(store.id)) } : {}),
      isLiveNow: context.liveStoreIds.has(String(store.id)),
    }),
  );
}
