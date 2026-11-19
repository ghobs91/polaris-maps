/**
 * Shared search query plan.
 *
 * One owner for the policies that decide what a query is asking for, how wide
 * the answer area is, and how its results may be presented. The unified engine
 * and the floating panel previously maintained separate copies of these
 * decisions — `SEARCH_AREA_RADIUS_KM` in the engine, `NEARBY_RESULT_KM` /
 * `DISTANT_RESULT_KM` / pin / fit constants plus `isGenericNearbyQuery` in the
 * panel — and every search regression fixed one copy while breaking another
 * (see the "fix(search)" history). Both layers now read this one object:
 *
 *  - `unifiedSearch.ts` gates result distance by `areaRadiusKm` and trims the
 *    answer to the radius `searchHorizon.ts` decides
 *  - panel helpers order/trim results by `tailRadiusKm` / `nearbyRadiusKm`
 *    and budget map pins by `maxRenderedPins`
 *  - panel camera fit honours `fitAnchorRadiusKm`, the chosen horizon, and the
 *    intent's framing permission
 *
 * Policies are static today (the same table answers every intent); the plan
 * exists so a future refinement — e.g. a wider tail for named places — changes
 * one typed field here, once, with one test.
 *
 * The answer *radius* is no longer static: it is decided per query from the
 * candidate distribution by `searchHorizon.ts`, and the resulting `horizon`
 * policy travels on the plan so the engine (result gate) and the panel (pins,
 * camera) read one number instead of each deriving their own.
 */

import { normalizeSearchText, isAddressQuery } from './queryParser';
import { resolveSearchCategories } from '../poi/categoryResolver';
import { HORIZON_POLICIES, type HorizonPolicy } from './searchHorizon';

export type QueryIntent =
  /** A street address or coordinate — an explicit destination. */
  | 'address'
  /** A generic category phrase ("bagels", "coffee near me") — answered locally. */
  | 'nearby'
  /** A proper place/brand name ("starbucks", "h&h bagels") — may frame far. */
  | 'named-place';

export interface QueryPlan {
  readonly intent: QueryIntent;
  /**
   * Result gating (engine): the area, in km around the camera or the user,
   * that answers a local-intent query. Explicit destinations (addresses,
   * trailing city names) are exempt in the engine, via its async GeoNames
   * check; the camera policy below decides whether the map may travel.
   */
  readonly areaRadiusKm: number;
  /**
   * Result tail (panel): rows farther than this from the search anchor leave
   * the merged list unless they are explicit destinations (addresses, cities).
   */
  readonly tailRadiusKm: number;
  /**
   * Result tail (panel): rows within this count as local to the user and are
   * ordered above the (kept) distant tail.
   */
  readonly nearbyRadiusKm: number;
  /**
   * Maximum result pins handed to the map layer. A rendering budget, not an
   * answer: the area a search is answered in is decided by `searchHorizon.ts`,
   * and `POILayer` clusters whatever arrives here into count badges.
   */
  readonly maxRenderedPins: number;
  /**
   * Camera fit (panel): a nearby-intent submit may move the camera only this
   * far from the anchor. Genuinely rural searches (~28 km category radius)
   * still frame their results; a cluster in the next city never yanks the map.
   */
  readonly fitAnchorRadiusKm: number;
  /**
   * Camera fit (panel): true when the intent says the user named a place
   * (address, brand, landmark) — a submit may frame a distant match.
   * "bagels" from Westbury must never fly the map to Manhattan.
   */
  readonly allowsDistantFraming: boolean;
  /**
   * Adaptive answer radius for this intent (see `searchHorizon.ts`): the radius
   * ladder, the strong-match target that picks a ring, and the fetch width that
   * keeps every ring populated. Replaces the zoom-derived search box.
   */
  readonly horizon: HorizonPolicy;
}

/** Filler words that don't turn a category phrase into a place lookup. */
const QUERY_MODIFIERS = new Set([
  'near',
  'nearby',
  'me',
  'my',
  'here',
  'around',
  'open',
  'now',
  'late',
  'best',
  'top',
  'rated',
  'good',
  'popular',
  'cheap',
  'closest',
  'nearest',
  'the',
  'a',
  'an',
  'in',
  'at',
  'on',
  'to',
  'for',
  'find',
  'search',
  'show',
]);

/**
 * True when the query is only a category phrase ("bagels", "coffee near me"),
 * i.e. the answer is expected around the user. A proper-name token ("h&h
 * bagels", "pizza palace") makes it a place lookup, which may frame a distant
 * match — Google pans to "H&H Bagels", but not to "bagels".
 */
function isGenericNearbyQuery(query: string): boolean {
  const words = normalizeSearchText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !QUERY_MODIFIERS.has(word));
  if (words.length === 0) return false;
  return words.every((word) => resolveSearchCategories(word) !== null);
}

/**
 * Classify the query into one of three intents.
 *
 * Address classification stays literal (a query that looks like an address is
 * one); everything that is not an address and not a bare category phrase is a
 * place/brand lookup, including single brands like "starbucks".
 */
function classifyIntent(query: string): QueryIntent {
  if (isAddressQuery(query)) return 'address';
  if (isGenericNearbyQuery(query)) return 'nearby';
  return 'named-place';
}

/** The canonical policy numbers. */
export const DEFAULT_QUERY_PLAN = {
  intent: 'named-place',
  areaRadiusKm: 75,
  tailRadiusKm: 120,
  nearbyRadiusKm: 50,
  maxRenderedPins: 24,
  fitAnchorRadiusKm: 30,
  allowsDistantFraming: true,
  horizon: HORIZON_POLICIES['named-place'],
} as const satisfies QueryPlan;

/** Build the plan for a user query. */
export function createQueryPlan(query: string): QueryPlan {
  const intent = classifyIntent(query);
  return {
    intent,
    areaRadiusKm: DEFAULT_QUERY_PLAN.areaRadiusKm,
    tailRadiusKm: DEFAULT_QUERY_PLAN.tailRadiusKm,
    nearbyRadiusKm: DEFAULT_QUERY_PLAN.nearbyRadiusKm,
    maxRenderedPins: DEFAULT_QUERY_PLAN.maxRenderedPins,
    fitAnchorRadiusKm: DEFAULT_QUERY_PLAN.fitAnchorRadiusKm,
    allowsDistantFraming: intent !== 'nearby',
    horizon: HORIZON_POLICIES[intent],
  };
}
