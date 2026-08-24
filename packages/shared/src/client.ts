import type { AnalyticsEvent } from './analytics';
import { ApiError, type ApiErrorBody } from './errors';
import type {
  CheckoutPreviewDto,
  LiveDetailDto,
  LiveMessageDto,
  LiveStatsDto,
  LiveSummaryDto,
  OrderDto,
  ProductDetailDto,
  ProductSummaryDto,
  SellerMetricsDto,
  SessionDto,
  StoreDetailDto,
  StoreSummaryDto,
  StreamCredentialsDto,
  UserDto,
  ViewerTokenResponseDto,
} from './schemas/entities';
import type {
  ConfirmPaymentRequest,
  CreateLiveRequest,
  CreateOrderRequest,
  CreateProductRequest,
  CreateStoreRequest,
  CheckoutPreviewRequest,
  FeatureProductRequest,
  LoginRequest,
  PostMessageRequest,
  ReactRequest,
  RegisterRequest,
  UpdateOrderStatusRequest,
  UpdateProductRequest,
  UpdateProfileRequest,
} from './schemas/requests';

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Resolved per request so a token refresh is picked up without rebuilding. */
  readonly getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  readonly fetch?: typeof globalThis.fetch;
  /** Forwarded to Next's extended fetch for revalidation control. */
  readonly defaultInit?: RequestInit;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(path.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * One thin transport used by the web app today and by the Expo app later.
 * It intentionally does no caching or state management: those belong to the
 * consumer, which knows whether it is a React Server Component or a screen.
 */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: RequestInit & { query?: Query } = {},
  ): Promise<T> {
    const { query, ...restInit } = init;
    const token = options.getToken ? await options.getToken() : null;

    const headers = new Headers({
      Accept: 'application/json',
      ...(options.defaultInit?.headers as Record<string, string> | undefined),
      ...(restInit.headers as Record<string, string> | undefined),
    });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await doFetch(buildUrl(options.baseUrl, path, query), {
        ...options.defaultInit,
        ...restInit,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiError(0, {
        code: 'NETWORK_ERROR',
        message: 'No pudimos conectarnos con el servidor.',
        details: { cause: String(cause) },
      });
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? safeJson(text) : null;

    if (!response.ok) {
      const errorBody: ApiErrorBody =
        isErrorBody(payload)
          ? payload
          : { code: 'UNKNOWN_ERROR', message: response.statusText || 'Error inesperado' };
      throw new ApiError(response.status, errorBody);
    }

    return payload as T;
  }

  return {
    request,

    auth: {
      register: (input: RegisterRequest) => request<SessionDto>('POST', '/auth/register', input),
      login: (input: LoginRequest) => request<SessionDto>('POST', '/auth/login', input),
      me: (init?: RequestInit) => request<UserDto>('GET', '/auth/me', undefined, init),
      updateProfile: (input: UpdateProfileRequest) => request<UserDto>('PATCH', '/auth/me', input),
    },

    stores: {
      list: (query?: Query, init?: RequestInit) =>
        request<StoreSummaryDto[]>('GET', '/stores', undefined, { ...init, query }),
      bySlug: (slug: string, init?: RequestInit) =>
        request<StoreDetailDto>('GET', `/stores/${slug}`, undefined, init),
      products: (slug: string, query?: Query, init?: RequestInit) =>
        request<ProductSummaryDto[]>('GET', `/stores/${slug}/products`, undefined, {
          ...init,
          query,
        }),
      create: (input: CreateStoreRequest) => request<StoreDetailDto>('POST', '/stores', input),
      mine: (init?: RequestInit) =>
        request<StoreDetailDto | null>('GET', '/stores/mine', undefined, init),
      follow: (storeId: string) => request<{ following: boolean }>('POST', `/stores/${storeId}/follow`),
      unfollow: (storeId: string) =>
        request<{ following: boolean }>('DELETE', `/stores/${storeId}/follow`),
      following: (init?: RequestInit) =>
        request<StoreSummaryDto[]>('GET', '/stores/following', undefined, init),
    },

    products: {
      featured: (query?: Query, init?: RequestInit) =>
        request<ProductSummaryDto[]>('GET', '/products', undefined, { ...init, query }),
      byId: (id: string, init?: RequestInit) =>
        request<ProductDetailDto>('GET', `/products/${id}`, undefined, init),
      create: (input: CreateProductRequest) =>
        request<ProductDetailDto>('POST', '/seller/products', input),
      update: (id: string, input: UpdateProductRequest) =>
        request<ProductDetailDto>('PATCH', `/seller/products/${id}`, input),
      listMine: (query?: Query, init?: RequestInit) =>
        request<ProductSummaryDto[]>('GET', '/seller/products', undefined, { ...init, query }),
      toggle: (id: string) => request<ProductDetailDto>('POST', `/seller/products/${id}/toggle`),
    },

    live: {
      list: (query?: Query, init?: RequestInit) =>
        request<LiveSummaryDto[]>('GET', '/live', undefined, { ...init, query }),
      byId: (id: string, init?: RequestInit) =>
        request<LiveDetailDto>('GET', `/live/${id}`, undefined, init),
      messages: (id: string, query?: Query, init?: RequestInit) =>
        request<LiveMessageDto[]>('GET', `/live/${id}/messages`, undefined, { ...init, query }),
      postMessage: (id: string, input: PostMessageRequest) =>
        request<LiveMessageDto>('POST', `/live/${id}/messages`, input),
      react: (id: string, input: ReactRequest) =>
        request<{ likeCount: number }>('POST', `/live/${id}/reactions`, input),
      join: (id: string) => request<{ viewerCount: number }>('POST', `/live/${id}/join`),
      leave: (id: string) => request<{ viewerCount: number }>('POST', `/live/${id}/leave`),
      stats: (id: string, init?: RequestInit) =>
        request<LiveStatsDto>('GET', `/live/${id}/stats`, undefined, init),
      /**
       * Short-lived credential for the WebSocket handshake. `token` is null
       * for anonymous visitors, who connect as guests.
       */
      realtimeToken: () =>
        request<{ token: string | null; expiresAt: string | null }>('POST', '/live/realtime-token'),
      /** Subscribe-only credential. `credentials` is null when there is nothing to watch. */
      viewerToken: (id: string) =>
        request<ViewerTokenResponseDto>('POST', `/live/${id}/viewer-token`),
      /** Publish credential. Seller-only; the server re-checks store ownership. */
      broadcastToken: (id: string) =>
        request<StreamCredentialsDto>('POST', `/seller/live/${id}/broadcast-token`),
      create: (input: CreateLiveRequest) => request<LiveDetailDto>('POST', '/seller/live', input),
      start: (id: string) => request<LiveDetailDto>('POST', `/seller/live/${id}/start`),
      end: (id: string) => request<LiveDetailDto>('POST', `/seller/live/${id}/end`),
      cancel: (id: string) => request<LiveDetailDto>('POST', `/seller/live/${id}/cancel`),
      feature: (id: string, input: FeatureProductRequest) =>
        request<LiveDetailDto>('POST', `/seller/live/${id}/feature`, input),
      listMine: (query?: Query, init?: RequestInit) =>
        request<LiveSummaryDto[]>('GET', '/seller/live', undefined, { ...init, query }),
    },

    orders: {
      preview: (storeId: string, input: CheckoutPreviewRequest) =>
        request<CheckoutPreviewDto>('POST', `/checkout/${storeId}/preview`, input),
      /**
       * `idempotencyKey` is required, not optional. Making it a parameter the
       * caller must supply is what stops a retry from silently becoming a
       * second order — an optional field would be forgotten exactly once, in
       * the one place it matters.
       */
      create: (storeId: string, input: CreateOrderRequest, idempotencyKey: string) =>
        request<OrderDto>('POST', `/checkout/${storeId}/orders`, input, {
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
      confirmPayment: (orderId: string, input: ConfirmPaymentRequest) =>
        request<OrderDto>('POST', `/orders/${orderId}/payment`, input),
      mine: (query?: Query, init?: RequestInit) =>
        request<OrderDto[]>('GET', '/orders', undefined, { ...init, query }),
      byId: (id: string, init?: RequestInit) =>
        request<OrderDto>('GET', `/orders/${id}`, undefined, init),
      cancel: (id: string) => request<OrderDto>('POST', `/orders/${id}/cancel`),
      sellerList: (query?: Query, init?: RequestInit) =>
        request<OrderDto[]>('GET', '/seller/orders', undefined, { ...init, query }),
      updateStatus: (id: string, input: UpdateOrderStatusRequest) =>
        request<OrderDto>('PATCH', `/seller/orders/${id}/status`, input),
    },

    seller: {
      metrics: (init?: RequestInit) =>
        request<SellerMetricsDto>('GET', '/seller/metrics', undefined, init),
    },

    analytics: {
      track: (event: AnalyticsEvent) =>
        request<void>('POST', '/analytics/events', {
          name: event.name,
          properties: event.properties,
          occurredAt: event.occurredAt,
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { code: 'INVALID_RESPONSE', message: text.slice(0, 200) };
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
