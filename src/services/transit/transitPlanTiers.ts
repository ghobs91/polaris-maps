/**
 * Tier selection for transit journey planning.
 *
 * The planner has four possible sources, and the important property is that the
 * choice is made **before any request is issued**. A "try and fall back" chain
 * looks equivalent and is not: every user in an uncovered area still reaches a
 * third-party server, which is precisely the load profile offline packs exist to
 * remove (see `docs/scaling-p2p.md`).
 *
 *   local      on-device timetable shipped with the region pack — zero requests
 *   regional   a registry OTP/MOTIS endpoint for the area (realtime where offered)
 *   transitous the global community MOTIS instance — opt-in and budgeted
 *   none       nothing can answer; a typed error the UI can explain
 *
 * Local is only usable when the pack both covers the query *and* its timetable
 * is inside its service window. An expired timetable must not answer: a
 * schedule-accurate-looking plan from last month's feed is worse than no plan.
 */

// ── Errors ───────────────────────────────────────────────────────────

export type TransitPlanFailureReason =
  /** No pack timetable covers the endpoints and no regional endpoint matched. */
  | 'no-coverage'
  /** The pack covers the area but its timetable is outside its service window. */
  | 'timetable-expired'
  /** The Transitous tier is on but this device spent today's allowance. */
  | 'transitous-budget-exhausted'
  /** A source was chosen and failed (network, upstream error, empty result). */
  | 'upstream-failed';

/**
 * Typed planner failure.
 *
 * Callers branch on `reason` instead of matching on message text, so the UI can
 * say "download the transit pack for this area" for `no-coverage` and "try again
 * later" for `upstream-failed`.
 */
export class TransitPlanError extends Error {
  readonly reason: TransitPlanFailureReason;

  constructor(reason: TransitPlanFailureReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'TransitPlanError';
    this.reason = reason;
  }
}

// ── Tiers ────────────────────────────────────────────────────────────

export type TransitPlanTier = 'local' | 'regional' | 'transitous' | 'none';

/** Local timetable state for the requested origin/destination/service date. */
export type LocalTimetableState = 'usable' | 'absent' | 'expired';

/** Transitous tier state for this device. */
export type TransitousTierState = 'allowed' | 'disabled' | 'budget-exhausted';

export interface TransitPlanTierInput {
  local: LocalTimetableState;
  /** A registry endpoint matched the origin. */
  regional: boolean;
  transitous: TransitousTierState;
}

export interface TransitPlanTierDecision {
  tier: TransitPlanTier;
  /** Set only when `tier === 'none'`; explains why nothing could answer. */
  reason?: TransitPlanFailureReason;
}

/**
 * The tiers that can answer, cheapest first.
 *
 * `decideTransitPlanTier` is derived from this so the two can never disagree
 * about ordering or eligibility.
 */
export function eligibleTransitPlanTiers(input: TransitPlanTierInput): TransitPlanTier[] {
  const tiers: TransitPlanTier[] = [];
  if (input.local === 'usable') tiers.push('local');
  if (input.regional) tiers.push('regional');
  if (input.transitous === 'allowed') tiers.push('transitous');
  return tiers;
}

/**
 * Pick the cheapest source that can actually answer.
 *
 * The reason returned alongside `none` names the most *specific* thing the user
 * could act on, which is why an expired timetable is reported ahead of the
 * generic no-coverage case.
 */
export function decideTransitPlanTier(input: TransitPlanTierInput): TransitPlanTierDecision {
  const [first] = eligibleTransitPlanTiers(input);
  if (first) return { tier: first };

  if (input.local === 'expired') {
    return { tier: 'none', reason: 'timetable-expired' };
  }
  if (input.transitous === 'budget-exhausted') {
    return { tier: 'none', reason: 'transitous-budget-exhausted' };
  }
  // "No transit data for this area" is the actionable message whenever nothing
  // could answer; a disabled live tier is not something the user can act on.
  return { tier: 'none', reason: 'no-coverage' };
}

/**
 * Human-readable explanation for a failure reason.
 *
 * Kept here so the string lives next to the reason it describes and cannot drift
 * from it; the UI renders this rather than inventing its own wording.
 */
export function describeTransitPlanFailure(reason: TransitPlanFailureReason): string {
  switch (reason) {
    case 'no-coverage':
      return 'No transit timetable is available for this area. Download the region pack for offline transit planning.';
    case 'timetable-expired':
      return 'The offline transit timetable for this area has expired. Update the region pack, or try a live source.';
    case 'transitous-budget-exhausted':
      return "Live transit planning has reached today's limit for this device.";
    case 'upstream-failed':
      return 'The transit service could not be reached. Try again shortly.';
  }
}
