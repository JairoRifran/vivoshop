import { Injectable } from '@nestjs/common';
import type {
  BusinessVerification,
  Dispute,
  Follow,
  IdentityVerification,
  LiveMessage,
  LiveSession,
  OAuthState,
  Order,
  Payment,
  Product,
  SellerPaymentAccount,
  Store,
  User,
} from '@vivo/domain';
import { buildDemoDataset, type DemoDataset } from '@vivo/seed';
import type { StoredAnalyticsEvent } from '../../../application/ports/repositories';

/**
 * One consumed idempotency key. Mirrors the `idempotency_keys` table so both
 * drivers enforce the same rule with the same data.
 */
export interface IdempotencyRecord {
  readonly scope: string;
  readonly key: string;
  readonly userId: string;
  readonly requestHash: string;
  readonly orderId: string | null;
  readonly createdAt: Date;
}

/**
 * The in-process datastore behind `DATA_DRIVER=memory`.
 *
 * It exists for two reasons that both matter beyond convenience: the product
 * can be demoed and developed with zero infrastructure, and every repository
 * gets a second implementation, which keeps the ports honest. If a use case
 * ever leaks SQL, this driver stops compiling.
 *
 * Everything is stored as immutable domain objects; writes replace entries
 * rather than mutating them, mirroring how the SQL driver behaves.
 */
@Injectable()
export class MemoryDatabase {
  readonly users = new Map<string, User>();
  readonly credentials = new Map<string, string>();
  readonly stores = new Map<string, Store>();
  readonly products = new Map<string, Product>();
  readonly liveSessions = new Map<string, LiveSession>();
  readonly liveMessages = new Map<string, LiveMessage>();
  readonly orders = new Map<string, Order>();
  readonly follows = new Map<string, Follow>();
  readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly analytics: StoredAnalyticsEvent[] = [];

  // --- Cobros y confianza (M03) --------------------------------------------
  readonly payments = new Map<string, Payment>();
  /** Avisos ya procesados, por `provider::eventId`. La idempotencia del webhook. */
  readonly webhookEvents = new Map<string, Date>();
  /** Cuentas de cobro, por `storeId::provider`. */
  readonly sellerAccounts = new Map<string, SellerPaymentAccount>();
  readonly oauthStates = new Map<string, OAuthState>();
  readonly businessVerifications = new Map<string, BusinessVerification>();
  readonly identityVerifications = new Map<string, IdentityVerification>();
  readonly disputes = new Map<string, Dispute>();

  private seeded = false;

  static followKey(userId: string, storeId: string): string {
    return `${userId}::${storeId}`;
  }

  static idempotencyKey(scope: string, key: string): string {
    return `${scope}::${key}`;
  }

  static accountKey(storeId: string, provider: string): string {
    return `${storeId}::${provider}`;
  }

  static webhookKey(provider: string, eventId: string): string {
    return `${provider}::${eventId}`;
  }

  /**
   * Loads the demo dataset once. `hashPassword` is injected because hashing is
   * a security concern the datastore must not own.
   */
  async seed(
    hashPassword: (plain: string) => Promise<string>,
    options: { now?: Date; force?: boolean } = {},
  ): Promise<void> {
    if (this.seeded && !options.force) return;

    const dataset: DemoDataset = buildDemoDataset(options.now ? { now: options.now } : {});
    this.clear();

    for (const user of dataset.users) {
      const { password, ...rest } = user;
      this.users.set(String(rest.id), rest);
      this.credentials.set(String(rest.id), await hashPassword(password));
    }
    for (const store of dataset.stores) this.stores.set(String(store.id), store);
    for (const product of dataset.products) this.products.set(String(product.id), product);
    for (const session of dataset.liveSessions) this.liveSessions.set(String(session.id), session);
    for (const message of dataset.liveMessages) this.liveMessages.set(String(message.id), message);
    for (const order of dataset.orders) this.orders.set(String(order.id), order);
    for (const follow of dataset.follows) {
      this.follows.set(MemoryDatabase.followKey(String(follow.userId), String(follow.storeId)), follow);
    }

    this.seeded = true;
  }

  clear(): void {
    this.users.clear();
    this.credentials.clear();
    this.stores.clear();
    this.products.clear();
    this.liveSessions.clear();
    this.liveMessages.clear();
    this.orders.clear();
    this.follows.clear();
    this.idempotency.clear();
    this.analytics.length = 0;
    this.payments.clear();
    this.webhookEvents.clear();
    this.sellerAccounts.clear();
    this.oauthStates.clear();
    this.businessVerifications.clear();
    this.identityVerifications.clear();
    this.disputes.clear();
    this.seeded = false;
  }
}
