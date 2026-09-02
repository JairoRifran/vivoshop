/**
 * Injection tokens for every port. Interfaces vanish at runtime, so Nest needs
 * a value to key the container by. Keeping them in one file makes the full set
 * of replaceable seams visible at a glance.
 */
export const USER_REPOSITORY = Symbol('UserRepository');
export const STORE_REPOSITORY = Symbol('StoreRepository');
export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
export const LIVE_REPOSITORY = Symbol('LiveRepository');
export const MESSAGE_REPOSITORY = Symbol('MessageRepository');
export const ORDER_REPOSITORY = Symbol('OrderRepository');
export const FOLLOW_REPOSITORY = Symbol('FollowRepository');
export const PUSH_SUBSCRIPTION_REPOSITORY = Symbol('PushSubscriptionRepository');
export const PUSH_DELIVERY_REPOSITORY = Symbol('PushDeliveryRepository');
export const ANALYTICS_REPOSITORY = Symbol('AnalyticsRepository');
/** Transactional boundary for order creation. See `order-transaction.ts`. */
export const ORDER_TRANSACTION_RUNNER = Symbol('OrderTransactionRunner');
/** Fan-out of business events to connected clients. See `ports/realtime.ts`. */
export const REALTIME_PUBLISHER = Symbol('RealtimePublisher');

export const CACHE_STORE = Symbol('CacheStore');
export const PRESENCE_STORE = Symbol('PresenceStore');

export const PAYMENT_PROVIDER = Symbol('PaymentProvider');
export const STREAMING_PROVIDER = Symbol('StreamingProvider');
export const NOTIFICATION_PROVIDER = Symbol('NotificationProvider');
export const SHIPPING_PROVIDER = Symbol('ShippingProvider');
export const STORAGE_PROVIDER = Symbol('StorageProvider');
/** El conjunto de proveedores de identidad habilitados. Ver `OAUTH_PROVIDERS`. */
export const IDENTITY_PROVIDERS = Symbol('IdentityProviders');
export const USER_IDENTITY_REPOSITORY = Symbol('UserIdentityRepository');
export const LOGIN_STATE_REPOSITORY = Symbol('LoginStateRepository');
export const EMAIL_PROVIDER = Symbol('EmailProvider');
export const PASSWORD_RESET_REPOSITORY = Symbol('PasswordResetRepository');

export const CLOCK = Symbol('Clock');
export const ID_GENERATOR = Symbol('IdGenerator');
