/**
 * Adaptive search horizon — how wide an area answers a query.
 *
 * The engine used to answer every query inside a box derived from the *map
 * zoom* (`deriveQueryContext`), so a search started from a street-level map was
 * confined to ~±9 km and returned the one or two shops that happened to sit
 * there, regardless of how good the matches were. The panel then trimmed the
 * map pins to the 5 nearest (`maxPins`) and clustered them into a 12 km
 * radius, so the camera zoomed *into* that handful instead of out to the set.
 * Searching "whole foods" therefore showed a single branch two miles away and
 * tapping the "Coffee" pill queried the visible screen and returned three
 * cafés — both the opposite of a maps answer.
 *
 * Apple Maps does the opposite, and the observable rule is volume-driven: a
 * query with many good matches is answered in a tight radius ("coffee" → the
 * best ~20 shops inside a few miles) and a query with few good matches is
 * answered in a wide one ("whole foods" → the seven branches across ~25 mi).
 *
 * This module owns that rule as data, not as a special case per source:
 *
 *  - a **ladder of radii** per intent (`HORIZON_POLICIES`),
 *  - a **target number of strong matches** the answer should contain,
 *  - `decideSearchHorizon`, which picks the smallest ladder ring that holds
 *    `targetMatches` strong candidates and returns it as the radius that
 *    answers the query (the camera, the pins, and the list all use it),
 *  - `horizonFitBounds`, the camera box for that radius.
 *
 * The chosen radius therefore shrinks when matches are dense and grows when
 * they are sparse — the observed Apple behaviour — without any per-query
 * tuneable and without depending on the zoom the search was started from.
 *
 * Consequences worth stating, because they are the point:
 *
 *  - Fetching is decoupled from zoom: sources are asked for the widest ring the
 *    intent allows (`maxRadiusKm`), and the horizon narrows the answer
 *    afterwards. One fetch, a deterministic display decision.
 *  - The ladder snaps upward, so a one-metre difference in the 12th match does
 *    not jitter the camera between two zoom levels.
 *  - `minRadiusKm` prevents a single match next door from framing a street
 *    corner as if it were the answer.
 */

import type { QueryIntent } from './queryPlan';
import { haversineKm } from './searchRanker';

/** Matching geometry shared by POIs, places and geocoding entries. */
export interface HorizonPoint {
  lat: number;
  lng: number;
}

/** Display bounds in the shape MapLibre's `fitBounds` consumes. */
export interface HorizonBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface HorizonPolicy {
  /**
   * How many strong matches the answer should try to hold. The radius is the
   * distance to this many matches: dense areas are answered narrowly, sparse
   * ones widely.
   */
  readonly targetMatches: number;
  /**
   * Never frame tighter than this (km) — one match next door is not an area.
   */
  readonly minRadiusKm: number;
  /**
   * Widest ring the ladder names, and the half-width of the box sources are
   * asked for. A *saturated* query (fewer strong matches than
   * `targetMatches`) may report a radius beyond this: the farthest match is the
   * answer, and a radius that stopped here would drop it from the list.
   */
  readonly maxRadiusKm: number;
  /**
   * Ascending radii (km) the chosen distance rounds up to. Snapping keeps the
   * camera stable between adjacent queries; the last ring must equal
   * `maxRadiusKm` so the ladder can always answer.
   */
  readonly ringsKm: readonly number[];
}

/**
 * Per-intent ladders.
 *
 * `nearby` covers bare category phrases ("coffee", the Coffee pill): the user
 * wants the good options around them, so a high match target makes the radius
 * collapse in dense areas (a suburb answers in 4–8 km). When the category is
 * sparse the ladder keeps growing — an "airport" search reaches the 30 km ring
 * rather than answering with whichever airport happens to be closest.
 *
 * `named-place` covers brands and proper names ("whole foods", "starbucks"),
 * where the answer is "the branches" and there are usually a handful across a
 * metro: a lower target lets the radius grow (Apple frames the same query at an
 * estimated ~25 mi), capped at 40 km.
 *
 * `address` is a single destination: a tight frame around the match.
 */
export const HORIZON_POLICIES: Record<QueryIntent, HorizonPolicy> = {
  nearby: {
    targetMatches: 20,
    minRadiusKm: 4,
    maxRadiusKm: 30,
    ringsKm: [4, 8, 12, 20, 30],
  },
  'named-place': {
    targetMatches: 10,
    minRadiusKm: 8,
    maxRadiusKm: 40,
    ringsKm: [8, 15, 25, 40],
  },
  address: {
    targetMatches: 5,
    minRadiusKm: 2,
    maxRadiusKm: 10,
    ringsKm: [2, 5, 10],
  },
};

/**
 * Match strength above which a candidate counts toward the target. Callers pass
 * `queryRelevanceScore` (distance-independent relevance), so this threshold is
 * about "is this the place that was asked for", never about how close it is.
 *
 * Deliberately below the ranker's strongest text tiers: a brand branch scores
 * 0.9–1.0, but 0.72 also admits a whole-word name hit (0.75) — a "coffee"
 * search that matches "The Coffee Grind" by name counts, while a POI that only
 * shares the word "food" with "whole foods" does not.
 */
export const HORIZON_STRONG_MATCH = 0.72;

/** Floating-point slack when counting matches against a ring radius. */
const RING_EPSILON_KM = 1e-6;

export interface HorizonDecision {
  /**
   * Radius (km) that answers the query: the ring holding `targetMatches` strong
   * candidates, clamped to the policy. `0` when nothing matched — callers must
   * treat that as "no horizon" and fall back to their own framing.
   */
  radiusKm: number;
  /** Distance to the target-th strong match, before ring snapping. */
  rawRadiusKm: number;
  /** Strong matches inside `radiusKm`. */
  strongMatches: number;
  /** All candidates inside `radiusKm`, strong or not. */
  candidateCount: number;
  /** True when the ladder ran out of candidates before reaching the target. */
  saturated: boolean;
}

export interface HorizonInput<C> {
  candidates: readonly C[];
  /** Search anchor — the same point results are scored and framed against. */
  anchor: HorizonPoint;
  policy: HorizonPolicy;
  /** 0–1 match strength; below `minStrength` the candidate does not count. */
  strength: (candidate: C) => number;
  /** Defaults to {@link HORIZON_STRONG_MATCH}. */
  minStrength?: number;
  /**
   * Coordinate of a candidate. Omit it when the candidate *is* its own point (a
   * POI); pass it when a candidate wraps one (a ranked result wrapping a POI).
   */
  anchorOf?: (candidate: C) => HorizonPoint;
}

/** Smallest ring ≥ `distanceKm`; `distanceKm` itself when the ladder is exhausted. */
function snapUpToRing(distanceKm: number, ringsKm: readonly number[]): number {
  for (const ring of ringsKm) {
    if (distanceKm <= ring + RING_EPSILON_KM) return ring;
  }
  return distanceKm;
}

/**
 * Pick the radius that answers a query.
 *
 * The rule is deliberately one sentence: *the smallest ladder ring holding
 * `targetMatches` strong matches* — or, when there are not that many, the
 * distance to the farthest strong match, which is what makes a sparse brand
 * query ("whole foods") frame the whole metro while a dense one ("coffee")
 * frames the neighbourhood.
 *
 * A saturated query is never trimmed by this radius: it has no spare matches to
 * drop, so the radius must reach the last one. Answering "outlets" in an area
 * with two outlet malls 60 km apart frames both; a radius that stopped at the
 * ladder's last ring would have listed one mall and quietly hidden the other.
 *
 * Pure: it only reads the candidate list, so the engine, the panel and the
 * pills all reach the same radius for the same candidates.
 */
export function decideSearchHorizon<C>(input: HorizonInput<C>): HorizonDecision {
  const { candidates, anchor, policy, strength, anchorOf } = input;
  const minStrength = input.minStrength ?? HORIZON_STRONG_MATCH;
  // Candidates that are their own coordinate (POIs, geocoding entries) are the
  // common case; only wrapped candidates need `anchorOf`.
  const pointOf = anchorOf ?? ((candidate: C) => candidate as unknown as HorizonPoint);

  const strongDistancesKm: number[] = [];
  for (const candidate of candidates) {
    if (strength(candidate) < minStrength) continue;
    const point = pointOf(candidate);
    strongDistancesKm.push(haversineKm(anchor.lat, anchor.lng, point.lat, point.lng));
  }

  if (strongDistancesKm.length === 0) {
    return { radiusKm: 0, rawRadiusKm: 0, strongMatches: 0, candidateCount: 0, saturated: false };
  }

  strongDistancesKm.sort((a, b) => a - b);

  const saturated = strongDistancesKm.length < policy.targetMatches;
  const rawRadiusKm = saturated
    ? strongDistancesKm[strongDistancesKm.length - 1]
    : strongDistancesKm[policy.targetMatches - 1];

  const radiusKm = Math.max(policy.minRadiusKm, snapUpToRing(rawRadiusKm, policy.ringsKm));

  let strongMatches = 0;
  for (const distanceKm of strongDistancesKm) {
    if (distanceKm > radiusKm + RING_EPSILON_KM) break;
    strongMatches++;
  }

  let candidateCount = 0;
  for (const candidate of candidates) {
    const point = pointOf(candidate);
    if (haversineKm(anchor.lat, anchor.lng, point.lat, point.lng) <= radiusKm + RING_EPSILON_KM) {
      candidateCount++;
    }
  }

  return { radiusKm, rawRadiusKm, strongMatches, candidateCount, saturated };
}

/** Kilometres per degree of latitude (spherical mean). */
const KM_PER_DEG_LAT = 111.32;

/** Padding applied to the framed box so edge pins are not flush to the border. */
const FRAME_PADDING = 1.08;

/**
 * Camera box for an answer radius.
 *
 * The frame is the horizon circle around the anchor, not the bounding box of
 * the matches: a search that decided on a 12 km radius should show the user the
 * area it was answered in, even when every match happens to sit on one side of
 * it. Matching Apple, the circle *is* the answer — the pins land inside it.
 *
 * Returns `null` for a non-positive radius so callers can keep their own
 * framing when nothing matched.
 */
export function horizonFitBounds(anchor: HorizonPoint, radiusKm: number): HorizonBounds | null {
  if (!(radiusKm > 0)) return null;

  const latSpan = (radiusKm / KM_PER_DEG_LAT) * FRAME_PADDING;
  const cosLat = Math.cos((anchor.lat * Math.PI) / 180);
  // Near the poles a degree of longitude shrinks; fall back to the latitude
  // span so the box stays valid instead of exploding toward infinity.
  const lngSpan =
    Math.abs(cosLat) > 0.01
      ? (radiusKm / (KM_PER_DEG_LAT * Math.abs(cosLat))) * FRAME_PADDING
      : latSpan;

  return {
    minLat: Math.max(-90, anchor.lat - latSpan),
    minLng: Math.max(-180, anchor.lng - lngSpan),
    maxLat: Math.min(90, anchor.lat + latSpan),
    maxLng: Math.min(180, anchor.lng + lngSpan),
  };
}

/**
 * Half-width (degrees) of the fetch box a query of this intent needs, so every
 * ladder ring can be populated from a single fetch.
 *
 * This is what decouples fetching from zoom: sources are asked for the widest
 * ring the intent allows, then {@link decideSearchHorizon} narrows the answer.
 */
export function horizonFetchRadiusDeg(policy: HorizonPolicy): number {
  return policy.maxRadiusKm / KM_PER_DEG_LAT;
}

/** True when a point falls inside an answer radius of the anchor. */
export function isWithinHorizon(
  point: HorizonPoint,
  anchor: HorizonPoint,
  radiusKm: number,
): boolean {
  if (!(radiusKm > 0)) return false;
  return haversineKm(anchor.lat, anchor.lng, point.lat, point.lng) <= radiusKm + RING_EPSILON_KM;
}
