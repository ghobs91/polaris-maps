import { getDatabase } from '../database/init';
import { findPlaceIdNear } from '../poi/poiService';
import { getSessionPlaceRating, placeRatingKey } from './placeRatingSessionCache';
import type { SavedPlace } from '../../models/placeList';
import type { ExternalRatingProviderId } from '../poi/externalRatings/types';

/**
 * Per-place review summaries for saved-list rows.
 *
 * Cheap and offline-safe by design: it shows an already-resolved external
 * rating from the session cache when present, and otherwise reads the on-device
 * community aggregate (`places.avg_rating` / `review_count`). It NEVER loads a
 * TripAdvisor/Yelp listing — external ratings stay on-demand on the place card,
 * per the `headless-browse-policy` spec.
 */

export interface PlaceReviewSummary {
  /** Average rating on a 0–5 scale. */
  rating: number;
  /** Number of reviews contributing to the average. */
  count: number;
  /** Where the aggregate came from. */
  source: 'external' | 'community';
  /** Contributing providers (external only), for attribution. */
  providers: ExternalRatingProviderId[];
}

/** Bound concurrent SQLite lookups so a long list never floods the DB. */
const MAX_CONCURRENT_LOOKUPS = 4;
/** Cache community aggregates briefly; reviews change rarely. */
const COMMUNITY_TTL_MS = 5 * 60 * 1000;

const communityCache = new Map<string, { summary: PlaceReviewSummary | null; at: number }>();

function communityKey(place: SavedPlace): string {
  return `${place.name.trim().toLowerCase()}|${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
}

async function resolveCommunitySummary(place: SavedPlace): Promise<PlaceReviewSummary | null> {
  const key = communityKey(place);
  const cached = communityCache.get(key);
  if (cached && Date.now() - cached.at < COMMUNITY_TTL_MS) return cached.summary;

  let summary: PlaceReviewSummary | null = null;
  try {
    const placeId = await findPlaceIdNear(place.lat, place.lng, place.name);
    if (placeId) {
      const db = await getDatabase();
      const row = await db.getFirstAsync<{
        avg_rating: number | null;
        review_count: number | null;
      }>('SELECT avg_rating, review_count FROM places WHERE uuid = ?', [placeId]);
      const count = row?.review_count ?? 0;
      if (row && count > 0 && row.avg_rating != null) {
        summary = {
          rating: Math.round(row.avg_rating * 10) / 10,
          count,
          source: 'community',
          providers: [],
        };
      }
    }
  } catch {
    summary = null;
  }

  communityCache.set(key, { summary, at: Date.now() });
  return summary;
}

/** Run `worker` over `items` with a bounded number of in-flight promises. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Resolve a review summary for each saved place, returning a map keyed by the
 * saved-place id. Places with nothing to show are absent.
 */
export async function loadPlaceReviewSummaries(
  places: SavedPlace[],
): Promise<Record<string, PlaceReviewSummary>> {
  const result: Record<string, PlaceReviewSummary> = {};
  const pending: SavedPlace[] = [];

  for (const place of places) {
    const external = getSessionPlaceRating(placeRatingKey(place));
    if (external) {
      result[place.id] = {
        rating: external.rating,
        count: external.reviewCount,
        source: 'external',
        providers: external.sources,
      };
      continue;
    }
    if (place.lat === 0 && place.lng === 0) continue;
    pending.push(place);
  }

  if (pending.length === 0) return result;

  const summaries = await runWithConcurrency(
    pending,
    MAX_CONCURRENT_LOOKUPS,
    resolveCommunitySummary,
  );
  pending.forEach((place, index) => {
    const summary = summaries[index];
    if (summary) result[place.id] = summary;
  });
  return result;
}

/** Clear the community-summary cache (tests). */
export function clearPlaceReviewSummaryCache(): void {
  communityCache.clear();
}
