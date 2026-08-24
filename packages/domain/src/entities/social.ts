import type { StoreId, UserId } from '../value-objects/identifiers';

/** A buyer following a store. The pair (userId, storeId) is unique. */
export interface Follow {
  readonly userId: UserId;
  readonly storeId: StoreId;
  /** Whether the follower wants a notification when the store goes live. */
  readonly notifyOnLive: boolean;
  readonly createdAt: Date;
}
