import type { ExternalRatingProviderId } from '../poi/externalRatings/types';

/**
 * Session-scoped cache of resolved external ratings, keyed by place identity.
 *
 * External ratings are deliberately transient and device-local (see the
 * `headless-browse-policy` spec): this cache lives only in memory, is never
 * written to disk, and is populated only when a place card actually resolves a
 * rating on demand. Saved-list rows read it so an already-resolved rating can be
 * shown without triggering any provider load in the background.
 */

export interface SessionPlaceRating {
  /** Weighted mean on a 0–5 scale. */
  rating: number;
  /** Summed exact review count across contributing providers. */
  reviewCount: number;
  /** Providers that contributed, for attribution. */
  sources: ExternalRatingProviderId[];
  /** Observation time (ms epoch). */
  observedAt: number;
}

/** Stable per-place key shared by the place card and the saved-list rows. */
export function placeRatingKey(input: { name: string; lat: number; lng: number }): string {
  const name = input.name.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${name}|${input.lat.toFixed(5)},${input.lng.toFixed(5)}`;
}

const cache = new Map<string, SessionPlaceRating>();
const listeners = new Set<() => void>();

// Session-scoped record of provider/place pairs that settled with no rating, so
// re-opening a card does not re-run the full browse pipeline. Transient and
// in-memory like the ratings themselves; a TTL lets a provider be retried later.
const MISS_TTL_MS = 10 * 60 * 1000;
const MAX_MISS_ENTRIES = 500;
const misses = new Map<string, number>();

export function getSessionPlaceRating(key: string): SessionPlaceRating | null {
  return cache.get(key) ?? null;
}

export function setSessionPlaceRating(key: string, rating: SessionPlaceRating): void {
  const existing = cache.get(key);
  if (
    existing &&
    existing.rating === rating.rating &&
    existing.reviewCount === rating.reviewCount &&
    existing.sources.length === rating.sources.length &&
    existing.sources.every((source, i) => source === rating.sources[i])
  ) {
    return;
  }
  cache.set(key, rating);
  listeners.forEach((listener) => listener());
}

export function subscribeSessionPlaceRatings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Record that a provider resolved to no rating for a place, within this session.
 * Uses the same stable key shape as {@link placeRatingKey}, prefixed by provider.
 */
export function markExternalRatingMiss(key: string, ttlMs: number = MISS_TTL_MS): void {
  if (misses.size >= MAX_MISS_ENTRIES) {
    const oldest = misses.keys().next().value;
    if (oldest !== undefined) misses.delete(oldest);
  }
  misses.set(key, Date.now() + ttlMs);
}

/** True while a provider is still known to have no rating for a place. */
export function isExternalRatingMiss(key: string): boolean {
  const expiresAt = misses.get(key);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    misses.delete(key);
    return false;
  }
  return true;
}

/** Clear the session miss record (tests / teardown). */
export function clearExternalRatingMisses(): void {
  misses.clear();
}

/** Drop the session cache (tests / teardown). */
export function clearSessionPlaceRatings(): void {
  clearExternalRatingMisses();
  if (cache.size === 0) return;
  cache.clear();
  listeners.forEach((listener) => listener());
}
