/**
 * Realtime correction for locally planned itineraries.
 *
 * The pack timetable is a schedule, so a Tier 0 plan is schedule-accurate and
 * nothing more. Where a live source exists, this applies the observed delay to
 * the boarding leg and propagates it down the rest of the journey.
 *
 * Deliberately narrow:
 *
 * - **One correction point.** Only the *first* transit leg is matched against
 *   live departures. That is the leg a rider is about to miss, it is the only
 *   one with a live source at plan time, and it keeps the request count at one
 *   per plan — which matters when the source is a third party.
 * - **Bounded propagation.** A delay beyond `MAX_PROPAGATED_DELAY_S` is treated
 *   as a bad match rather than shifting the whole journey by an hour.
 * - **Never invents realtime.** A leg is only marked `realTime: true` when a
 *   live value actually replaced a scheduled one.
 *
 * The matching and shifting are pure so they can be tested without a network.
 */

import type { OtpItinerary, OtpLeg } from '../../models/transit';

// ── Tunables ─────────────────────────────────────────────────────────

/** A live departure must be within this many seconds of the scheduled one. */
export const LIVE_MATCH_TOLERANCE_S = 180;

/** Delays larger than this are rejected as a mismatched departure. */
export const MAX_PROPAGATED_DELAY_S = 900;

// ── Types ────────────────────────────────────────────────────────────

/** The subset of a live departure this module needs. */
export interface LiveDeparture {
  /** Route badge, e.g. "4" or "LIRR". */
  routeName: string;
  /** Scheduled departure, epoch ms. */
  scheduledMs: number;
  /** Live departure, epoch ms. Absent when the source has no realtime value. */
  realtimeMs?: number;
  /** Feed trip id, when the source provides one. */
  tripId?: string;
}

export interface OverlayOptions {
  matchToleranceS?: number;
  maxDelayS?: number;
}

// ── Pure logic ───────────────────────────────────────────────────────

/** Index of the first transit leg, or -1 when the journey is walk-only. */
export function firstTransitLegIndex(itinerary: OtpItinerary): number {
  return itinerary.legs.findIndex((leg) => leg.mode !== 'WALK' && leg.mode !== 'BICYCLE');
}

/**
 * Find the live departure that corresponds to a leg.
 *
 * A trip-id match wins outright; otherwise the route badge plus a scheduled-time
 * proximity check decides. Anything ambiguous is treated as no match, because
 * applying the wrong departure's delay is worse than showing the schedule.
 */
export function matchLiveDeparture(
  leg: OtpLeg,
  live: readonly LiveDeparture[],
  toleranceS: number = LIVE_MATCH_TOLERANCE_S,
): LiveDeparture | null {
  if (leg.mode === 'WALK' || leg.mode === 'BICYCLE') return null;

  const routeName = leg.route?.shortName ?? leg.route?.longName;
  if (leg.tripId) {
    const byTrip = live.find((d) => d.tripId && d.tripId === leg.tripId);
    if (byTrip) return byTrip;
  }
  if (!routeName) return null;

  let best: LiveDeparture | null = null;
  let bestDelta = Infinity;
  for (const departure of live) {
    if (departure.routeName !== routeName) continue;
    const delta = Math.abs(departure.scheduledMs - leg.startTime) / 1000;
    if (delta <= toleranceS && delta < bestDelta) {
      best = departure;
      bestDelta = delta;
    }
  }
  return best;
}

/** Shift a leg (and everything it implies) by `deltaMs`. */
function shiftLeg(leg: OtpLeg, deltaMs: number, markRealtime: boolean): OtpLeg {
  return {
    ...leg,
    startTime: leg.startTime + deltaMs,
    endTime: leg.endTime + deltaMs,
    realTime: markRealtime || leg.realTime,
    from: leg.from.departure
      ? {
          ...leg.from,
          departure: {
            ...leg.from.departure,
            scheduledTime: leg.from.departure.scheduledTime,
            estimated: {
              time: new Date(leg.startTime + deltaMs).toISOString(),
              delay: Math.round(deltaMs / 1000),
            },
          },
        }
      : leg.from,
    to: leg.to.arrival
      ? {
          ...leg.to,
          arrival: {
            ...leg.to.arrival,
            scheduledTime: leg.to.arrival.scheduledTime,
            estimated: {
              time: new Date(leg.endTime + deltaMs).toISOString(),
              delay: Math.round(deltaMs / 1000),
            },
          },
        }
      : leg.to,
  };
}

/**
 * Apply live delays to an itinerary.
 *
 * Returns a new itinerary; the input is never mutated. When no live departure
 * matches, the itinerary is returned unchanged and no leg is marked realtime.
 */
export function applyRealtimeToItinerary(
  itinerary: OtpItinerary,
  live: readonly LiveDeparture[],
  options: OverlayOptions = {},
): OtpItinerary {
  const toleranceS = options.matchToleranceS ?? LIVE_MATCH_TOLERANCE_S;
  const maxDelayS = options.maxDelayS ?? MAX_PROPAGATED_DELAY_S;

  const index = firstTransitLegIndex(itinerary);
  if (index === -1) return itinerary;

  const boardingLeg = itinerary.legs[index];
  const match = matchLiveDeparture(boardingLeg, live, toleranceS);
  if (!match || match.realtimeMs === undefined) return itinerary;

  const delayS = Math.round((match.realtimeMs - match.scheduledMs) / 1000);
  if (delayS === 0) return itinerary;
  if (Math.abs(delayS) > maxDelayS) return itinerary;

  // A departure cannot leave before the rider can arrive at the stop, so clamp
  // the shift to the preceding walk leg's arrival.
  const previous = index > 0 ? itinerary.legs[index - 1] : null;
  const earliestBoarding = previous ? previous.endTime : itinerary.legs[index].startTime;
  const shiftedStart = Math.max(earliestBoarding, boardingLeg.startTime + delayS * 1000);
  const effectiveDelayMs = shiftedStart - boardingLeg.startTime;
  if (effectiveDelayMs === 0) return itinerary;

  const legs = itinerary.legs.map((leg, i) =>
    i < index ? leg : shiftLeg(leg, effectiveDelayMs, i === index),
  );

  const startMs = legs[0].startTime;
  const endMs = legs[legs.length - 1].endTime;

  return {
    ...itinerary,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    duration: Math.max(0, Math.round((endMs - startMs) / 1000)),
    legs,
  };
}

/** Apply the overlay to a list of itineraries. */
export function applyRealtimeToItineraries(
  itineraries: readonly OtpItinerary[],
  live: readonly LiveDeparture[],
  options: OverlayOptions = {},
): OtpItinerary[] {
  if (live.length === 0) return [...itineraries];
  return itineraries.map((itinerary) => applyRealtimeToItinerary(itinerary, live, options));
}

/**
 * Convert `StopDeparture` rows from the departures service into overlay input.
 *
 * Kept separate so the overlay never depends on the departures module's shape,
 * and so a source that provides only scheduled times simply contributes nothing.
 */
export function toLiveDepartures(
  departures: readonly {
    routeName: string;
    scheduledTime: string;
    realtimeTime?: string;
    tripId?: string;
  }[],
): LiveDeparture[] {
  const out: LiveDeparture[] = [];
  for (const departure of departures) {
    const scheduledMs = Date.parse(departure.scheduledTime);
    if (!Number.isFinite(scheduledMs)) continue;
    const realtimeMs = departure.realtimeTime ? Date.parse(departure.realtimeTime) : undefined;
    out.push({
      routeName: departure.routeName,
      scheduledMs,
      realtimeMs: realtimeMs !== undefined && Number.isFinite(realtimeMs) ? realtimeMs : undefined,
      tripId: departure.tripId,
    });
  }
  return out;
}
