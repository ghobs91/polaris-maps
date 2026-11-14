/**
 * Tier selection for transit journey planning.
 *
 * The point of the pure decision is that it happens before any request: an
 * uncovered area must cost zero third-party calls, and a failure must carry a
 * reason the UI can act on.
 */

import {
  TransitPlanError,
  decideTransitPlanTier,
  describeTransitPlanFailure,
  eligibleTransitPlanTiers,
  type TransitPlanFailureReason,
} from '../../src/services/transit/transitPlanTiers';

describe('eligibleTransitPlanTiers', () => {
  it('orders local before regional before transitous', () => {
    expect(
      eligibleTransitPlanTiers({ local: 'usable', regional: true, transitous: 'allowed' }),
    ).toEqual(['local', 'regional', 'transitous']);
  });

  it('omits tiers that cannot answer', () => {
    expect(
      eligibleTransitPlanTiers({ local: 'absent', regional: false, transitous: 'disabled' }),
    ).toEqual([]);
    expect(
      eligibleTransitPlanTiers({ local: 'expired', regional: true, transitous: 'disabled' }),
    ).toEqual(['regional']);
  });

  it('treats an exhausted budget as unavailable', () => {
    expect(
      eligibleTransitPlanTiers({
        local: 'absent',
        regional: false,
        transitous: 'budget-exhausted',
      }),
    ).toEqual([]);
  });
});

describe('decideTransitPlanTier', () => {
  it('picks the cheapest eligible tier', () => {
    expect(
      decideTransitPlanTier({ local: 'usable', regional: true, transitous: 'allowed' }),
    ).toEqual({ tier: 'local' });
    expect(
      decideTransitPlanTier({ local: 'absent', regional: true, transitous: 'allowed' }),
    ).toEqual({ tier: 'regional' });
    expect(
      decideTransitPlanTier({ local: 'absent', regional: false, transitous: 'allowed' }),
    ).toEqual({ tier: 'transitous' });
  });

  it('prefers the local tier when it is usable', () => {
    expect(
      decideTransitPlanTier({ local: 'usable', regional: false, transitous: 'disabled' }),
    ).toEqual({ tier: 'local' });
  });

  describe('when nothing can answer', () => {
    it('reports an expired timetable ahead of generic no-coverage', () => {
      expect(
        decideTransitPlanTier({ local: 'expired', regional: false, transitous: 'disabled' }),
      ).toEqual({ tier: 'none', reason: 'timetable-expired' });
    });

    it('reports an exhausted budget', () => {
      expect(
        decideTransitPlanTier({ local: 'absent', regional: false, transitous: 'budget-exhausted' }),
      ).toEqual({ tier: 'none', reason: 'transitous-budget-exhausted' });
    });

    it('reports no-coverage when the live tier is simply switched off', () => {
      // "Download the region pack" is actionable; "not enabled in this build" is not.
      expect(
        decideTransitPlanTier({ local: 'absent', regional: false, transitous: 'disabled' }),
      ).toEqual({ tier: 'none', reason: 'no-coverage' });
    });

    it('still prefers the live tier when it is available', () => {
      expect(
        decideTransitPlanTier({ local: 'absent', regional: false, transitous: 'allowed' }),
      ).toEqual({ tier: 'transitous' });
    });
  });
});

describe('TransitPlanError', () => {
  it('carries a machine-readable reason', () => {
    const error = new TransitPlanError('timetable-expired', 'feed ended 2026-01-01');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransitPlanError');
    expect(error.reason).toBe('timetable-expired');
    expect(error.message).toContain('feed ended');
  });

  it('uses the reason as the message when no detail is given', () => {
    expect(new TransitPlanError('no-coverage').message).toBe('no-coverage');
  });
});

describe('describeTransitPlanFailure', () => {
  const reasons: TransitPlanFailureReason[] = [
    'no-coverage',
    'timetable-expired',
    'transitous-budget-exhausted',
    'upstream-failed',
  ];

  it('has user-facing copy for every reason', () => {
    for (const reason of reasons) {
      const text = describeTransitPlanFailure(reason);
      expect(text.length).toBeGreaterThan(10);
      // Copy must not leak the raw token to the user.
      expect(text).not.toContain(reason);
    }
  });
});
