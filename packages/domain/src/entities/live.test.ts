import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  ACTIVE_LIVE_STATUSES,
  BROADCASTER_GRACE_SECONDS,
  LIVE_STATUSES,
  WATCHABLE_LIVE_STATUSES,
  assertLiveTransition,
  canIssueBroadcastCredentials,
  canIssueViewerCredentials,
  canTransitionLive,
  capabilitiesFor,
  elapsedSeconds,
  graceExpired,
  isActiveLive,
  isFinished,
  isStartingSoon,
  isWatchable,
  type LiveStatus,
} from './live';

/**
 * The state machine is the part of M02 that is cheapest to get wrong and most
 * expensive to get wrong in production: a session marked `ended` because a
 * phone lost signal for ten seconds is a lost sale nobody can undo.
 *
 * These tests enumerate the graph exhaustively rather than spot-checking it,
 * so adding a status without thinking about every edge fails here first.
 */
describe('live session state machine', () => {
  const ALL: readonly LiveStatus[] = LIVE_STATUSES;

  /** The complete set of legal edges. Anything not listed must be rejected. */
  const LEGAL: ReadonlyArray<readonly [LiveStatus, LiveStatus]> = [
    ['scheduled', 'starting'],
    ['scheduled', 'cancelled'],
    ['starting', 'live'],
    ['starting', 'ended'],
    ['starting', 'cancelled'],
    ['live', 'interrupted'],
    ['live', 'ending'],
    ['interrupted', 'live'],
    ['interrupted', 'ending'],
    ['interrupted', 'ended'],
    ['ending', 'ended'],
  ];

  it('accepts exactly the legal edges and nothing else', () => {
    const legal = new Set(LEGAL.map(([from, to]) => from + '->' + to));

    for (const from of ALL) {
      for (const to of ALL) {
        expect({ from, to, allowed: canTransitionLive(from, to) }).toEqual({
          from,
          to,
          allowed: legal.has(from + '->' + to),
        });
      }
    }
  });

  it('walks the happy path from scheduled to ended', () => {
    const path: LiveStatus[] = ['scheduled', 'starting', 'live', 'ending', 'ended'];
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(() => assertLiveTransition(path[index]!, path[index + 1]!)).not.toThrow();
    }
  });

  it('fails a start that never connects backwards, not into a fake live', () => {
    expect(canTransitionLive('starting', 'ended')).toBe(true);
    // The only ways into `live` are through `starting` and back from a drop.
    // Nothing may skip provisioning and claim to be on air.
    for (const from of ALL) {
      if (from === 'starting' || from === 'interrupted') continue;
      expect(canTransitionLive(from, 'live')).toBe(false);
    }
  });

  it('treats a dropped broadcaster as recoverable, never as ended', () => {
    expect(canTransitionLive('live', 'interrupted')).toBe(true);
    expect(canTransitionLive('interrupted', 'live')).toBe(true);
    // The damaging move: `live` must not jump straight to `ended`, so no code
    // path can finalise a session without passing through `ending`.
    expect(canTransitionLive('live', 'ended')).toBe(false);
  });

  it('makes ended and cancelled terminal', () => {
    for (const to of ALL) {
      expect(canTransitionLive('ended', to)).toBe(false);
      expect(canTransitionLive('cancelled', to)).toBe(false);
    }
    expect(() => assertLiveTransition('ended', 'live')).toThrow(DomainError);
  });

  it('refuses to cancel a session that is already on air', () => {
    // Cancelling means "this never happened". Once viewers have watched and
    // bought, the honest end state is `ended`.
    expect(canTransitionLive('live', 'cancelled')).toBe(false);
    expect(canTransitionLive('ending', 'cancelled')).toBe(false);
  });

  it('reports a stable error code the API can map', () => {
    try {
      assertLiveTransition('ended', 'live');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INVALID_LIVE_TRANSITION');
    }
  });
});

describe('live session predicates', () => {
  it('separates "owns a channel" from "worth showing a player for"', () => {
    expect([...ACTIVE_LIVE_STATUSES]).toEqual(['starting', 'live', 'interrupted', 'ending']);
    expect([...WATCHABLE_LIVE_STATUSES]).toEqual(['live', 'interrupted']);

    // `starting` holds a channel but has nothing on screen yet; `interrupted`
    // has both, because the buyer should keep waiting rather than be ejected.
    expect(isActiveLive({ status: 'starting' })).toBe(true);
    expect(isWatchable({ status: 'starting' })).toBe(false);
    expect(isWatchable({ status: 'interrupted' })).toBe(true);
  });

  it('knows which sessions are over', () => {
    expect(isFinished({ status: 'ended' })).toBe(true);
    expect(isFinished({ status: 'cancelled' })).toBe(true);
    expect(isFinished({ status: 'interrupted' })).toBe(false);
  });

  it('measures elapsed time against now while running', () => {
    const startedAt = new Date('2026-03-01T20:00:00.000Z');
    const now = new Date('2026-03-01T20:12:30.000Z');
    expect(elapsedSeconds({ startedAt, endedAt: null }, now)).toBe(750);
    expect(elapsedSeconds({ startedAt: null, endedAt: null }, now)).toBe(0);
  });

  it('flags sessions starting within the hour', () => {
    const now = new Date('2026-03-01T20:00:00.000Z');
    expect(
      isStartingSoon(
        { status: 'scheduled', scheduledAt: new Date('2026-03-01T20:30:00.000Z') },
        now,
      ),
    ).toBe(true);
    expect(
      isStartingSoon(
        { status: 'scheduled', scheduledAt: new Date('2026-03-02T20:30:00.000Z') },
        now,
      ),
    ).toBe(false);
    expect(isStartingSoon({ status: 'live', scheduledAt: null }, now)).toBe(false);
  });
});

describe('broadcaster grace period', () => {
  const dropped = new Date('2026-03-01T20:00:00.000Z');

  it('does not expire a session that was never interrupted', () => {
    expect(graceExpired({ interruptedAt: null }, dropped)).toBe(false);
  });

  it('holds the session open for the whole grace window', () => {
    const almost = new Date(dropped.getTime() + (BROADCASTER_GRACE_SECONDS - 1) * 1000);
    expect(graceExpired({ interruptedAt: dropped }, almost)).toBe(false);
  });

  it('expires exactly at the boundary', () => {
    const boundary = new Date(dropped.getTime() + BROADCASTER_GRACE_SECONDS * 1000);
    expect(graceExpired({ interruptedAt: dropped }, boundary)).toBe(true);
  });
});

describe('participant capabilities', () => {
  it('lets a broadcaster publish and a viewer only subscribe', () => {
    expect(capabilitiesFor('broadcaster')).toEqual({
      canPublishMedia: true,
      canSubscribe: true,
      canModerate: false,
    });
    expect(capabilitiesFor('viewer')).toEqual({
      canPublishMedia: false,
      canSubscribe: true,
      canModerate: false,
    });
  });

  it('never grants a broadcaster administrative powers', () => {
    // A seller runs their own shop, not the platform. Moderation is a future
    // role, and until it exists nobody gets it by accident.
    expect(capabilitiesFor('broadcaster').canModerate).toBe(false);
  });
});

describe('credential eligibility', () => {
  it('allows publishing only into a session that can still be broadcast', () => {
    const allowed: LiveStatus[] = ['scheduled', 'starting', 'live', 'interrupted'];
    for (const status of LIVE_STATUSES) {
      expect({ status, allowed: canIssueBroadcastCredentials({ status }) }).toEqual({
        status,
        allowed: allowed.includes(status),
      });
    }
  });

  it('admits viewers only where there is something to watch', () => {
    for (const status of LIVE_STATUSES) {
      expect({ status, allowed: canIssueViewerCredentials({ status }) }).toEqual({
        status,
        allowed: WATCHABLE_LIVE_STATUSES.includes(status),
      });
    }
  });

  it('refuses to resurrect a finished broadcast', () => {
    expect(canIssueBroadcastCredentials({ status: 'ended' })).toBe(false);
    expect(canIssueBroadcastCredentials({ status: 'cancelled' })).toBe(false);
    expect(canIssueViewerCredentials({ status: 'ended' })).toBe(false);
  });
});
