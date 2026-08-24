import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  IdGenerator,
  PaymentIntent,
  PaymentProvider,
} from '../../application/ports/infrastructure';
import { ID_GENERATOR } from '../../application/ports/tokens';

/**
 * Simulated payments for M01.
 *
 * It is deliberately a *complete* implementation of `PaymentProvider` rather
 * than a stub that returns `true`: it creates a reference, tracks state, and
 * can reject. That way the checkout use case, the order state machine and the
 * UI all exercise the same paths they will exercise against Mercado Pago, and
 * the only thing that changes on integration day is which class is bound to
 * `PAYMENT_PROVIDER`.
 *
 * Next step (M02): `MercadoPagoProvider` implementing this same interface,
 * creating a real preference and reconciling through a webhook controller.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock';

  private readonly logger = new Logger(MockPaymentProvider.name);
  private readonly intents = new Map<string, PaymentIntent>();

  constructor(@Inject(ID_GENERATOR) private readonly ids: IdGenerator) {}

  async createIntent(input: {
    orderId: string;
    amountMinor: number;
    currency: string;
    installments: number;
    description: string;
  }): Promise<PaymentIntent> {
    const reference = this.ids.generate('pay');
    const intent: PaymentIntent = { reference, status: 'pending', checkoutUrl: null };
    this.intents.set(reference, intent);

    this.logger.log(
      `Simulated payment intent ${reference} for order ${input.orderId}: ` +
        `${input.amountMinor} ${input.currency} in ${input.installments}x`,
    );
    return intent;
  }

  async confirm(input: {
    reference: string;
    outcome: 'approved' | 'rejected';
  }): Promise<PaymentIntent> {
    const intent: PaymentIntent = {
      reference: input.reference,
      status: input.outcome === 'approved' ? 'approved' : 'rejected',
      checkoutUrl: null,
    };
    this.intents.set(input.reference, intent);
    this.logger.log(`Simulated payment ${input.reference} -> ${intent.status}`);
    return intent;
  }
}
