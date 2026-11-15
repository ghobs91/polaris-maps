/**
 * Pure offline-routing graph selection.
 *
 * A device can hold several Valhalla graphs at once (one per downloaded metro).
 * This module picks the best graph for a set of route points without touching
 * the filesystem or the native engine, so it stays trivially testable.
 */

export interface LatLngBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutingGraphCandidate {
  /** Stable identifier (catalog region id or downloaded region id). */
  id: string;
  /** Absolute native filesystem path to the Valhalla tiles directory. */
  dir: string;
  bounds: LatLngBounds;
}

/** True when (`lat`, `lng`) falls inside `bounds`. */
export function boundsContainPoint(bounds: LatLngBounds, lat: number, lng: number): boolean {
  return (
    lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng
  );
}

/** Bounding-box area in square degrees (only used for tie-breaking). */
export function boundsArea(bounds: LatLngBounds): number {
  return Math.max(0, bounds.maxLat - bounds.minLat) * Math.max(0, bounds.maxLng - bounds.minLng);
}

/** Smallest box containing both inputs. Used to widen a stale catalog box with
 *  the bounds a graph was actually published under. */
export function unionBounds(a: LatLngBounds, b: LatLngBounds): LatLngBounds {
  return {
    minLat: Math.min(a.minLat, b.minLat),
    maxLat: Math.max(a.maxLat, b.maxLat),
    minLng: Math.min(a.minLng, b.minLng),
    maxLng: Math.max(a.maxLng, b.maxLng),
  };
}

/**
 * True for bounds too wide to reason about with a single axis-aligned box.
 *
 * A pack like Kiribati spans nearly the whole longitude range as one box, so
 * "which metro graphs does this box intersect" answers with Jakarta, Nairobi
 * and Singapore — metros the pack has no data for. Past the antimeridian
 * threshold the bbox stops describing the pack's real coverage, so metro
 * targeting is skipped instead of guessing.
 */
export function isGlobishBounds(bounds: LatLngBounds): boolean {
  const lngSpan = Math.abs(bounds.maxLng - bounds.minLng);
  const latSpan = Math.abs(bounds.maxLat - bounds.minLat);
  return lngSpan >= MAX_TRUSTWORTHY_LNG_SPAN || latSpan >= MAX_TRUSTWORTHY_LAT_SPAN;
}

/** Longitude span past which a pack's bbox stops implying contiguous coverage. */
export const MAX_TRUSTWORTHY_LNG_SPAN = 180;

/** Latitude span past which a pack's bbox stops implying contiguous coverage. */
export const MAX_TRUSTWORTHY_LAT_SPAN = 90;

/**
 * Fraction (0–1) of `entry` that falls inside `pack`.
 *
 * A metro graph is only worth downloading when most of that metro's roads are
 * inside the pack — otherwise the graph is dead weight, or worse, it is
 * selected for a route it cannot finish.
 */
export function entryCoverage(entry: LatLngBounds, pack: LatLngBounds): number {
  const entryArea = boundsArea(entry);
  if (entryArea <= 0) return 0;
  const overlapLat = Math.min(entry.maxLat, pack.maxLat) - Math.max(entry.minLat, pack.minLat);
  const overlapLng = Math.min(entry.maxLng, pack.maxLng) - Math.max(entry.minLng, pack.minLng);
  // A shared edge is not coverage: a box that only touches lat=41 must not pull
  // the graph for the metro that starts there.
  if (overlapLat <= 0 || overlapLng <= 0) return 0;
  return (overlapLat * overlapLng) / entryArea;
}

/** Defaults for {@link selectRoutingGraphTargets}. */
export const DEFAULT_MAX_ROUTING_TARGETS = 4;
export const DEFAULT_MIN_ENTRY_COVERAGE = 0.5;

export interface RoutingTargetOptions {
  /** Cap on how many graphs one region download may pull. */
  maxTargets?: number;
  /** Minimum fraction of a metro that must lie inside the pack. */
  minCoverage?: number;
  /**
   * Id of the region pack being downloaded (e.g. `north-america-us-new-york`).
   *
   * Needed to tell "this pack is that metro" from "this metro's bounding box
   * happens to sit inside this pack's rectangle": a New York *state* pack
   * contains Toronto's box (across Lake Ontario, in Canada) just as squarely as
   * it contains New York City's. Without an id, geometry alone cannot separate
   * the two, so a pack much larger than a metro only claims metros whose id
   * shares a name token with it.
   */
  packId?: string;
}

/** A pack no more than this many times a metro's area is that metro's own pack. */
const SAME_METRO_AREA_RATIO = 4;

/** Lowercase name tokens long enough to be meaningful (`us` is not). */
function nameTokens(id: string): string[] {
  return id
    .toLowerCase()
    .split('-')
    .filter((token) => token.length >= 3);
}

function sharesNameToken(a: string, b: string): boolean {
  const right = new Set(nameTokens(b));
  return nameTokens(a).some((token) => right.has(token));
}

/**
 * Pick the metro graphs worth downloading for a region pack.
 *
 * Ordered by how completely the pack covers each metro, so the cap spends its
 * budget on the metros the pack actually holds rather than on whatever happens
 * to share a corner of the bbox.
 */
export function selectRoutingGraphTargets<T extends { bounds: LatLngBounds; id?: string }>(
  entries: readonly T[],
  pack: LatLngBounds,
  options: RoutingTargetOptions = {},
): T[] {
  if (isGlobishBounds(pack)) return [];

  const maxTargets = options.maxTargets ?? DEFAULT_MAX_ROUTING_TARGETS;
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_ENTRY_COVERAGE;
  const packId = options.packId;
  const packArea = boundsArea(pack);

  const relevant = (entry: T): boolean => {
    // Metro-sized pack: its bbox *is* the metro's, so matching ids are optional.
    if (packArea <= boundsArea(entry.bounds) * SAME_METRO_AREA_RATIO) return true;
    // Otherwise the pack is a bigger administrative area; require it to name
    // the metro, which rejects metros that merely fall inside its rectangle.
    if (!packId) return true;
    const entryId = entry.id;
    return !!entryId && sharesNameToken(packId, entryId);
  };

  return entries
    .map((entry) => ({ entry, coverage: entryCoverage(entry.bounds, pack) }))
    .filter(({ entry, coverage }) => coverage >= minCoverage && relevant(entry))
    .sort(
      (a, b) => b.coverage - a.coverage || boundsArea(a.entry.bounds) - boundsArea(b.entry.bounds),
    )
    .slice(0, maxTargets)
    .map(({ entry }) => entry);
}

/**
 * Choose the installed graph that covers the most route points. Ties break
 * toward the smallest graph (most specific coverage), so a metro graph beats a
 * state-wide one that also contains the points.
 *
 * Returns null when no candidate covers any point.
 */
export function selectRoutingGraph(
  candidates: RoutingGraphCandidate[],
  points: LatLng[],
): RoutingGraphCandidate | null {
  let best: RoutingGraphCandidate | null = null;
  let bestCovered = 0;
  let bestArea = Infinity;

  for (const candidate of candidates) {
    const covered = points.filter((p) => boundsContainPoint(candidate.bounds, p.lat, p.lng)).length;
    if (covered === 0) continue;
    const area = boundsArea(candidate.bounds);
    if (covered > bestCovered || (covered === bestCovered && area < bestArea)) {
      best = candidate;
      bestCovered = covered;
      bestArea = area;
    }
  }

  return best;
}
