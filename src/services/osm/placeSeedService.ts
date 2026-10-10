/**
 * Automatic seeding of Overture-sourced places into OpenStreetMap.
 *
 * When a signed-in user actively selects (or opens the detail view of) an
 * Overture-sourced place that is not already in OSM, we submit it as a new OSM
 * node using OSM-compatible tags. This lets Polaris Maps users help fill gaps
 * in OpenStreetMap without manual data entry.
 *
 * Duplicate protection is layered:
 *  1. a persistent on-device ledger keyed by Overture GERS id;
 *  2. a conservative Overpass existence check (fuzzy name + category + distance
 *     + brand/phone/website signals);
 *  3. in-session and in-flight dedup so the same place is never submitted twice
 *     across the map card and the detail screen, or by a React Strict Mode
 *     double-mount.
 *
 * When the existence check can't be trusted (Overpass outage) we fail closed:
 * the submission is skipped (status `unverified`) rather than risking a
 * duplicate.
 */
import { checkPoiExistsInOsm } from '../poi/osmFetcher';
import { submitOsmNodeCreate } from './osmEditService';
import { hasSeededOverturePlace, recordSeededOverturePlace } from './overtureSeedLedger';

/** Changeset comment used for every auto-seeded node. */
export const OVERTURE_SEED_CHANGESET_COMMENT = 'Added Overture Maps POI via Polaris Maps';

export type PlaceSeedStatus = 'submitted' | 'exists' | 'skipped' | 'unverified' | 'error';

export interface PlaceSeedResult {
  status: PlaceSeedStatus;
  /** Assigned when a node was created. */
  nodeId?: number;
  /** Assigned when a node was created. */
  changesetId?: number;
  /** Human-readable reason when `status === 'error'`. */
  error?: string;
}

export interface PlaceSeedTarget {
  lat: number;
  lng: number;
  name: string;
  /** OSM-compatible tags (see `placeToOsmTags` / `osmTagsFromPoi`). */
  tags: Record<string, string>;
  /** Overture GERS id, used for the persistent on-device submission ledger. */
  overtureId?: string;
}

/** Round to ~11 m precision so sub-metre jitter doesn't defeat dedup. */
function roundCoord(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Stable session key for a place (normalized name + rounded coordinates). */
export function placeSeedKey(lat: number, lng: number, name: string): string {
  return `${roundCoord(lat)},${roundCoord(lng)},${name.trim().toLowerCase()}`;
}

/** Places already submitted (or found to exist) this session. */
const seededKeys = new Set<string>();
/** Places the user chose to add manually, so auto-seed leaves them alone. */
const handledKeys = new Set<string>();
/** Places currently being submitted, to collapse concurrent triggers. */
const inFlightKeys = new Set<string>();

/** True when this place was already seeded or handled this session. */
export function wasPlaceSeedHandled(lat: number, lng: number, name: string): boolean {
  const key = placeSeedKey(lat, lng, name);
  return seededKeys.has(key) || handledKeys.has(key) || inFlightKeys.has(key);
}

/**
 * Mark a place as handled manually (e.g. the user pressed "Add to
 * OpenStreetMap"). Auto-seeding will skip it for the rest of the session so a
 * manual submission can't be duplicated by the automatic one.
 */
export function markPlaceHandled(lat: number, lng: number, name: string): void {
  handledKeys.add(placeSeedKey(lat, lng, name));
}

/**
 * Submit a place to OSM unless it already exists or was already handled.
 *
 * @param target       Place coordinates, name, and OSM-compatible tags.
 * @param accessToken  A valid OSM OAuth token with `write_api` scope.
 */
export async function seedPlaceToOsm(
  target: PlaceSeedTarget,
  accessToken: string,
): Promise<PlaceSeedResult> {
  const key = placeSeedKey(target.lat, target.lng, target.name);
  if (seededKeys.has(key) || handledKeys.has(key) || inFlightKeys.has(key)) {
    return { status: 'skipped' };
  }

  // On-device ledger: never resubmit a place this device already added, even
  // when offline or when OSM's own data hasn't caught up yet.
  if (target.overtureId && hasSeededOverturePlace(target.overtureId)) {
    seededKeys.add(key);
    return { status: 'skipped' };
  }

  inFlightKeys.add(key);
  try {
    // Guard against duplicates already in OSM. Fail closed: when the check
    // can't be trusted (Overpass outage), skip rather than risk a duplicate.
    try {
      const exists = await checkPoiExistsInOsm(target.lat, target.lng, target.name, target.tags);
      if (exists) {
        seededKeys.add(key);
        return { status: 'exists' };
      }
    } catch (e) {
      return { status: 'unverified', error: (e as Error).message };
    }

    const { nodeId, changesetId } = await submitOsmNodeCreate(
      accessToken,
      target.lat,
      target.lng,
      target.tags,
      OVERTURE_SEED_CHANGESET_COMMENT,
    );
    seededKeys.add(key);
    if (target.overtureId) recordSeededOverturePlace(target.overtureId, nodeId);
    return { status: 'submitted', nodeId, changesetId };
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  } finally {
    inFlightKeys.delete(key);
  }
}

/** Clear all session state (exposed for tests). */
export function clearPlaceSeedState(): void {
  seededKeys.clear();
  handledKeys.clear();
  inFlightKeys.clear();
}
