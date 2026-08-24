import { Injectable } from '@nestjs/common';
import type {
  BusinessVerification,
  Dispute,
  IdentityVerification,
  OAuthState,
  Order,
  OrderId,
  Payment,
  PaymentId,
  SellerPaymentAccount,
  StoreId,
  UserId,
} from '@vivo/domain';
import type {
  DisputeRepository,
  OAuthStateRepository,
  PaymentRepository,
  PaymentTransaction,
  PaymentTransactionRunner,
  SellerPaymentAccountRepository,
  VerificationRepository,
} from '../../../application/ports/payments';
import { MemoryDatabase } from './memory-database';

/**
 * Los repositorios de cobros del driver en memoria.
 *
 * Existen por la misma razón que los demás: mantienen honestos a los puertos.
 * Si un servicio filtrara SQL, este archivo dejaría de compilar. Y la paridad
 * con Drizzle no es una aspiración —la prueban los mismos tests contra los dos
 * drivers.
 */
@Injectable()
export class MemoryPaymentRepository implements PaymentRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async create(payment: Payment): Promise<Payment> {
    this.db.payments.set(String(payment.id), payment);
    return payment;
  }

  async update(payment: Payment): Promise<Payment> {
    this.db.payments.set(String(payment.id), payment);
    return payment;
  }

  async findById(id: PaymentId): Promise<Payment | null> {
    return this.db.payments.get(String(id)) ?? null;
  }

  async findByOrderId(orderId: OrderId): Promise<Payment | null> {
    for (const payment of this.db.payments.values()) {
      if (payment.orderId && String(payment.orderId) === String(orderId)) return payment;
    }
    return null;
  }

  async findByProviderPaymentId(
    provider: string,
    providerPaymentId: string,
  ): Promise<Payment | null> {
    for (const payment of this.db.payments.values()) {
      if (payment.provider === provider && payment.providerPaymentId === providerPaymentId) {
        return payment;
      }
    }
    return null;
  }

  async listByStore(storeId: StoreId, limit = 50): Promise<Payment[]> {
    return [...this.db.payments.values()]
      .filter((payment) => String(payment.storeId) === String(storeId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listExpired(now: Date): Promise<Payment[]> {
    return [...this.db.payments.values()].filter(
      (payment) =>
        payment.status === 'pending' &&
        payment.expiresAt !== null &&
        payment.expiresAt.getTime() <= now.getTime(),
    );
  }
}

@Injectable()
export class MemorySellerPaymentAccountRepository implements SellerPaymentAccountRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async find(storeId: StoreId, provider: string): Promise<SellerPaymentAccount | null> {
    return this.db.sellerAccounts.get(MemoryDatabase.accountKey(String(storeId), provider)) ?? null;
  }

  async findByExternalId(
    provider: string,
    externalAccountId: string,
  ): Promise<SellerPaymentAccount | null> {
    for (const account of this.db.sellerAccounts.values()) {
      if (account.provider === provider && account.externalAccountId === externalAccountId) {
        return account;
      }
    }
    return null;
  }

  async save(account: SellerPaymentAccount): Promise<SellerPaymentAccount> {
    this.db.sellerAccounts.set(
      MemoryDatabase.accountKey(String(account.storeId), account.provider),
      account,
    );
    return account;
  }

  async remove(storeId: StoreId, provider: string): Promise<void> {
    this.db.sellerAccounts.delete(MemoryDatabase.accountKey(String(storeId), provider));
  }
}

@Injectable()
export class MemoryOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async create(state: OAuthState): Promise<void> {
    this.db.oauthStates.set(state.state, state);
  }

  /** Consume: devolverlo dos veces es lo que este método impide. */
  async consume(state: string, now: Date): Promise<OAuthState | null> {
    const existing = this.db.oauthStates.get(state);
    if (!existing || existing.consumedAt) return null;
    this.db.oauthStates.set(state, { ...existing, consumedAt: now });
    return existing;
  }
}

@Injectable()
export class MemoryDisputeRepository implements DisputeRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async create(dispute: Dispute): Promise<Dispute> {
    this.db.disputes.set(String(dispute.orderId), dispute);
    return dispute;
  }

  async update(dispute: Dispute): Promise<Dispute> {
    this.db.disputes.set(String(dispute.orderId), dispute);
    return dispute;
  }

  async findByOrderId(orderId: OrderId): Promise<Dispute | null> {
    return this.db.disputes.get(String(orderId)) ?? null;
  }
}

@Injectable()
export class MemoryVerificationRepository implements VerificationRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findBusinessByStore(storeId: StoreId): Promise<BusinessVerification | null> {
    return this.db.businessVerifications.get(String(storeId)) ?? null;
  }

  async saveBusiness(verification: BusinessVerification): Promise<BusinessVerification> {
    this.db.businessVerifications.set(String(verification.storeId), verification);
    return verification;
  }

  async findIdentityByUser(userId: UserId): Promise<IdentityVerification | null> {
    return this.db.identityVerifications.get(String(userId)) ?? null;
  }

  async saveIdentity(verification: IdentityVerification): Promise<IdentityVerification> {
    this.db.identityVerifications.set(String(verification.userId), verification);
    return verification;
  }
}

/**
 * La transacción del webhook, en memoria.
 *
 * Mismo diseño que la de creación de pedidos: un mutex para que dos avisos
 * simultáneos no se interleaven en un `await`, y escrituras bufferizadas para
 * que un fallo no deje media aplicación hecha. La excepción es
 * `claimWebhookEvent`, que escribe ya —el mutex garantiza que nadie más corre—
 * y se deshace en el rollback, para que el reintento del proveedor encuentre
 * el aviso como no visto.
 */
@Injectable()
export class MemoryPaymentTransactionRunner implements PaymentTransactionRunner {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly db: MemoryDatabase) {}

  async run<T>(work: (tx: PaymentTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const transaction = new MemoryPaymentTransaction(this.db);
    try {
      const result = await work(transaction);
      transaction.commit();
      return result;
    } catch (error) {
      transaction.discard();
      throw error;
    } finally {
      release();
    }
  }
}

class MemoryPaymentTransaction implements PaymentTransaction {
  private readonly writes: Array<() => void> = [];
  private readonly rollbacks: Array<() => void> = [];

  constructor(private readonly db: MemoryDatabase) {}

  commit(): void {
    for (const write of this.writes) write();
    this.writes.length = 0;
    this.rollbacks.length = 0;
  }

  discard(): void {
    for (const rollback of this.rollbacks.reverse()) rollback();
    this.rollbacks.length = 0;
    this.writes.length = 0;
  }

  async claimWebhookEvent(input: {
    provider: string;
    eventId: string;
  }): Promise<boolean> {
    const key = MemoryDatabase.webhookKey(input.provider, input.eventId);
    if (this.db.webhookEvents.has(key)) return false;

    this.db.webhookEvents.set(key, new Date());
    this.rollbacks.push(() => this.db.webhookEvents.delete(key));
    return true;
  }

  async loadPayment(id: PaymentId): Promise<Payment | null> {
    return this.db.payments.get(String(id)) ?? null;
  }

  async savePayment(payment: Payment): Promise<Payment> {
    this.writes.push(() => this.db.payments.set(String(payment.id), payment));
    return payment;
  }

  async loadOrder(id: OrderId): Promise<Order | null> {
    return this.db.orders.get(String(id)) ?? null;
  }

  async saveOrder(order: Order): Promise<Order> {
    this.writes.push(() => this.db.orders.set(String(order.id), order));
    return order;
  }

  async releaseStock(order: Order): Promise<void> {
    this.writes.push(() => {
      for (const item of order.items) {
        const product = this.db.products.get(String(item.productId));
        if (!product) continue;
        this.db.products.set(String(product.id), {
          ...product,
          variants: product.variants.map((variant) =>
            String(variant.id) === String(item.variantId)
              ? { ...variant, stock: variant.stock + item.quantity }
              : variant,
          ),
        });
      }
    });
  }
}
