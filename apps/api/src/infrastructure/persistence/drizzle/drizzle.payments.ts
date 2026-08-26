import { Inject, Injectable } from '@nestjs/common';
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
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type {
  DisputeRepository,
  OAuthStateRepository,
  PaymentRepository,
  PaymentTransaction,
  PaymentTransactionRunner,
  SellerPaymentAccountRepository,
  VerificationRepository,
} from '../../../application/ports/payments';
import { SECRET_BOX, type SecretBox } from '../../crypto/secret-box';
import { DRIZZLE, type VivoDatabase } from './client';
import { toOrder } from './mappers';
import {
  fromAccount,
  fromBusinessVerification,
  fromDispute,
  fromIdentityVerification,
  fromPayment,
  toAccount,
  toBusinessVerification,
  toDispute,
  toIdentityVerification,
  toOAuthState,
  toPayment,
} from './payment.mappers';
import * as t from './schema';

type Tx = Parameters<Parameters<VivoDatabase['transaction']>[0]>[0];

@Injectable()
export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async create(payment: Payment): Promise<Payment> {
    await this.db.insert(t.payments).values(fromPayment(payment));
    return payment;
  }

  async update(payment: Payment): Promise<Payment> {
    await this.db
      .update(t.payments)
      .set(fromPayment(payment))
      .where(eq(t.payments.id, String(payment.id)));
    return payment;
  }

  async findById(id: PaymentId): Promise<Payment | null> {
    const [row] = await this.db
      .select()
      .from(t.payments)
      .where(eq(t.payments.id, String(id)))
      .limit(1);
    return row ? toPayment(row) : null;
  }

  async findByOrderId(orderId: OrderId): Promise<Payment | null> {
    const [row] = await this.db
      .select()
      .from(t.payments)
      .where(eq(t.payments.orderId, String(orderId)))
      .limit(1);
    return row ? toPayment(row) : null;
  }

  async findByProviderPaymentId(
    provider: string,
    providerPaymentId: string,
  ): Promise<Payment | null> {
    const [row] = await this.db
      .select()
      .from(t.payments)
      .where(
        and(
          eq(t.payments.provider, provider),
          eq(t.payments.providerPaymentId, providerPaymentId),
        ),
      )
      .limit(1);
    return row ? toPayment(row) : null;
  }

  async listByStore(storeId: StoreId, limit = 50): Promise<Payment[]> {
    const rows = await this.db
      .select()
      .from(t.payments)
      .where(eq(t.payments.storeId, String(storeId)))
      .orderBy(desc(t.payments.createdAt))
      .limit(limit);
    return rows.map(toPayment);
  }

  async listLapsedReservations(input: { now: Date; createdBefore: Date }): Promise<Payment[]> {
    const rows = await this.db
      .select()
      .from(t.payments)
      .where(
        and(
          eq(t.payments.status, 'pending'),
          or(
            lte(t.payments.expiresAt, input.now),
            and(isNull(t.payments.expiresAt), lte(t.payments.createdAt, input.createdBefore)),
          ),
        ),
      );
    return rows.map(toPayment);
  }
}

@Injectable()
export class DrizzleSellerPaymentAccountRepository implements SellerPaymentAccountRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: VivoDatabase,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
  ) {}

  async find(storeId: StoreId, provider: string): Promise<SellerPaymentAccount | null> {
    const [row] = await this.db
      .select()
      .from(t.sellerPaymentAccounts)
      .where(
        and(
          eq(t.sellerPaymentAccounts.storeId, String(storeId)),
          eq(t.sellerPaymentAccounts.provider, provider),
        ),
      )
      .limit(1);
    return row ? toAccount(row, this.secrets) : null;
  }

  async findByExternalId(
    provider: string,
    externalAccountId: string,
  ): Promise<SellerPaymentAccount | null> {
    const [row] = await this.db
      .select()
      .from(t.sellerPaymentAccounts)
      .where(
        and(
          eq(t.sellerPaymentAccounts.provider, provider),
          eq(t.sellerPaymentAccounts.externalAccountId, externalAccountId),
        ),
      )
      .limit(1);
    return row ? toAccount(row, this.secrets) : null;
  }

  async save(account: SellerPaymentAccount): Promise<SellerPaymentAccount> {
    const values = fromAccount(account, this.secrets);
    await this.db
      .insert(t.sellerPaymentAccounts)
      .values(values)
      .onConflictDoUpdate({
        target: [t.sellerPaymentAccounts.storeId, t.sellerPaymentAccounts.provider],
        set: values,
      });
    return account;
  }

  async remove(storeId: StoreId, provider: string): Promise<void> {
    await this.db
      .delete(t.sellerPaymentAccounts)
      .where(
        and(
          eq(t.sellerPaymentAccounts.storeId, String(storeId)),
          eq(t.sellerPaymentAccounts.provider, provider),
        ),
      );
  }
}

@Injectable()
export class DrizzleOAuthStateRepository implements OAuthStateRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async create(state: OAuthState): Promise<void> {
    await this.db.insert(t.oauthStates).values({
      state: state.state,
      storeId: String(state.storeId),
      provider: state.provider,
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
      consumedAt: null,
    });
  }

  /**
   * Marca y devuelve, en una sola sentencia.
   *
   * `WHERE consumed_at IS NULL` dentro del `UPDATE` es lo que lo hace seguro:
   * dos callbacks simultáneos con el mismo `state` compiten en la base y solo
   * uno se lleva la fila.
   */
  async consume(state: string, now: Date): Promise<OAuthState | null> {
    const [row] = await this.db
      .update(t.oauthStates)
      .set({ consumedAt: now })
      .where(and(eq(t.oauthStates.state, state), isNull(t.oauthStates.consumedAt)))
      .returning();
    return row ? toOAuthState({ ...row, consumedAt: null }) : null;
  }
}

@Injectable()
export class DrizzleDisputeRepository implements DisputeRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async create(dispute: Dispute): Promise<Dispute> {
    await this.db.insert(t.disputes).values(fromDispute(dispute));
    return dispute;
  }

  async update(dispute: Dispute): Promise<Dispute> {
    await this.db
      .update(t.disputes)
      .set(fromDispute(dispute))
      .where(eq(t.disputes.orderId, String(dispute.orderId)));
    return dispute;
  }

  async findByOrderId(orderId: OrderId): Promise<Dispute | null> {
    const [row] = await this.db
      .select()
      .from(t.disputes)
      .where(eq(t.disputes.orderId, String(orderId)))
      .limit(1);
    return row ? toDispute(row) : null;
  }
}

@Injectable()
export class DrizzleVerificationRepository implements VerificationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async findBusinessByStore(storeId: StoreId): Promise<BusinessVerification | null> {
    const [row] = await this.db
      .select()
      .from(t.businessVerifications)
      .where(eq(t.businessVerifications.storeId, String(storeId)))
      .limit(1);
    return row ? toBusinessVerification(row) : null;
  }

  async saveBusiness(verification: BusinessVerification): Promise<BusinessVerification> {
    const values = fromBusinessVerification(verification);
    await this.db
      .insert(t.businessVerifications)
      .values(values)
      .onConflictDoUpdate({ target: t.businessVerifications.storeId, set: values });
    return verification;
  }

  async findIdentityByUser(userId: UserId): Promise<IdentityVerification | null> {
    const [row] = await this.db
      .select()
      .from(t.identityVerifications)
      .where(eq(t.identityVerifications.userId, String(userId)))
      .limit(1);
    return row ? toIdentityVerification(row) : null;
  }

  async saveIdentity(verification: IdentityVerification): Promise<IdentityVerification> {
    const values = fromIdentityVerification(verification);
    await this.db
      .insert(t.identityVerifications)
      .values(values)
      .onConflictDoUpdate({ target: t.identityVerifications.userId, set: values });
    return verification;
  }
}

/**
 * La transacción del webhook, en PostgreSQL.
 *
 * Una sola transacción para el aviso, el pago, el pedido y el stock. Si algo
 * falla, la base deshace las cuatro cosas —incluido el registro del aviso—, y
 * el reintento del proveedor vuelve a encontrar trabajo por hacer en vez de un
 * duplicado que se descarta.
 */
@Injectable()
export class DrizzlePaymentTransactionRunner implements PaymentTransactionRunner {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async run<T>(work: (tx: PaymentTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(new DrizzlePaymentTransaction(tx)));
  }
}

class DrizzlePaymentTransaction implements PaymentTransaction {
  constructor(private readonly tx: Tx) {}

  /**
   * Insert con clave primaria compuesta, no un "leer y después escribir".
   *
   * `ON CONFLICT DO NOTHING` es lo que lo vuelve seguro bajo concurrencia: dos
   * avisos idénticos que llegan a la vez compiten en la base y solo uno recibe
   * una fila de vuelta.
   */
  async claimWebhookEvent(input: {
    provider: string;
    eventId: string;
    paymentId: PaymentId | null;
  }): Promise<boolean> {
    const inserted = await this.tx
      .insert(t.paymentWebhookEvents)
      .values({
        provider: input.provider,
        eventId: input.eventId,
        paymentId: input.paymentId ? String(input.paymentId) : null,
      })
      .onConflictDoNothing()
      .returning({ eventId: t.paymentWebhookEvents.eventId });

    return inserted.length > 0;
  }

  async loadPayment(id: PaymentId): Promise<Payment | null> {
    const [row] = await this.tx
      .select()
      .from(t.payments)
      .where(eq(t.payments.id, String(id)))
      .for('update')
      .limit(1);
    return row ? toPayment(row) : null;
  }

  async savePayment(payment: Payment): Promise<Payment> {
    await this.tx
      .update(t.payments)
      .set(fromPayment(payment))
      .where(eq(t.payments.id, String(payment.id)));
    return payment;
  }

  async loadOrder(id: OrderId): Promise<Order | null> {
    const [row] = await this.tx
      .select()
      .from(t.orders)
      .where(eq(t.orders.id, String(id)))
      .for('update')
      .limit(1);
    if (!row) return null;

    const items = await this.tx
      .select()
      .from(t.orderItems)
      .where(eq(t.orderItems.orderId, String(id)));
    return toOrder(row, items);
  }

  async saveOrder(order: Order): Promise<Order> {
    await this.tx
      .update(t.orders)
      .set({
        status: order.status,
        protectionStatus: order.protection,
        payment: order.payment as unknown as Record<string, unknown>,
        timeline: order.timeline as unknown as Array<Record<string, unknown>>,
        updatedAt: order.updatedAt,
      })
      .where(eq(t.orders.id, String(order.id)));
    return order;
  }

  /**
   * Repone las unidades reservadas.
   *
   * Un `UPDATE` por línea con la suma calculada en la base, no leída y
   * reescrita: dos liberaciones simultáneas de pedidos distintos que tocan la
   * misma variante tienen que sumar las dos.
   */
  async releaseStock(order: Order): Promise<void> {
    for (const item of order.items) {
      await this.tx
        .update(t.productVariants)
        .set({ stock: sql`${t.productVariants.stock} + ${item.quantity}` })
        .where(eq(t.productVariants.id, String(item.variantId)));
    }
  }
}
