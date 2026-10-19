/**
 * Persistent place → provider-listing map.
 *
 * Re-opening a place used to start a fresh provider **search** every time, the
 * noisiest request the app makes. Remembering the listing URL a search already
 * confirmed means the next open loads the listing directly (or serves the
 * in-memory rating), and a place is never searched twice for the same provider.
 *
 * Only the listing URL and observation time are stored — no review text, no
 * personal data. Entries expire after {@link LISTING_TTL_MS}.
 */

import { deleteLedgerFile, readLedgerFile, writeLedgerFile } from './ledgerFile';
import type { ExternalRatingProviderId } from './types';

const LEDGER_NAME = 'listing-cache.json';
export const LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export type ListingOrigin = 'tag' | 'website' | 'search';

export interface CachedListing {
  url: string;
  origin: ListingOrigin;
}

interface ListingEntry {
  url: string;
  observedAt: number;
  origin: ListingOrigin;
}

interface ListingLedger {
  version: 1;
  entries: Record<string, ListingEntry>;
}

let entries = new Map<string, ListingEntry>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let persistEnabled = true;

function keyFor(provider: ExternalRatingProviderId, placeKey: string): string {
  return `${provider}:${placeKey}`;
}

function scheduleSave(): void {
  if (!hydrated || !persistEnabled) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const persisted: Record<string, ListingEntry> = {};
    for (const [key, entry] of entries) persisted[key] = entry;
    writeLedgerFile(LEDGER_NAME, { version: 1, entries: persisted } satisfies ListingLedger);
  }, 250);
}

/** Load persisted listings once. Never rejects. */
export function hydrateListingCache(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydratePromise) {
    hydratePromise = readLedgerFile<ListingLedger>(LEDGER_NAME)
      .then((ledger) => {
        if (ledger?.version === 1 && ledger.entries) {
          const t = Date.now();
          for (const [key, entry] of Object.entries(ledger.entries)) {
            if (!entry?.url || t - entry.observedAt > LISTING_TTL_MS) continue;
            // Missing provenance is treated as search-derived so identity is
            // re-confirmed rather than trusted implicitly.
            entries.set(key, {
              url: entry.url,
              observedAt: entry.observedAt,
              origin: entry.origin ?? 'search',
            });
          }
        }
        hydrated = true;
      })
      .catch(() => {
        hydrated = true;
      });
  }
  return hydratePromise;
}

/** A previously confirmed listing URL for this place, when still fresh. */
export function getCachedListing(
  provider: ExternalRatingProviderId,
  placeKey: string,
): CachedListing | null {
  const entry = entries.get(keyFor(provider, placeKey));
  if (!entry) return null;
  if (Date.now() - entry.observedAt > LISTING_TTL_MS) {
    entries.delete(keyFor(provider, placeKey));
    return null;
  }
  return { url: entry.url, origin: entry.origin };
}

/** Remember a listing URL after a tag, website link, or search confirmed it. */
export function setCachedListing(
  provider: ExternalRatingProviderId,
  placeKey: string,
  url: string,
  origin: ListingOrigin,
): void {
  const key = keyFor(provider, placeKey);
  const existing = entries.get(key);
  if (existing?.url === url) {
    existing.observedAt = Date.now();
    existing.origin = origin;
    scheduleSave();
    return;
  }
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(key, { url, observedAt: Date.now(), origin });
  scheduleSave();
}

/** Drop the listing cache (tests / teardown). */
export function clearListingCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  entries = new Map();
  hydrated = true;
  hydratePromise = Promise.resolve();
  persistEnabled = false;
  deleteLedgerFile(LEDGER_NAME);
}

// Start loading at module init; the first lookups are synchronous best-effort.
void hydrateListingCache();
