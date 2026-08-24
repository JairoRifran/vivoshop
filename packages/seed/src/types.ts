import type {
  Follow,
  LiveMessage,
  LiveSession,
  Order,
  Product,
  Store,
  User,
} from '@vivo/domain';

/**
 * A demo user carries its plaintext password because the seeder is the only
 * component allowed to hash it. Nothing else in the system ever sees one.
 */
export interface DemoUser extends User {
  readonly password: string;
}

export interface DemoDataset {
  readonly users: readonly DemoUser[];
  readonly stores: readonly Store[];
  readonly products: readonly Product[];
  readonly liveSessions: readonly LiveSession[];
  readonly liveMessages: readonly LiveMessage[];
  readonly follows: readonly Follow[];
  readonly orders: readonly Order[];
}

export interface DemoDatasetOptions {
  /** Anchors every relative timestamp so runs are reproducible in tests. */
  readonly now?: Date;
}
