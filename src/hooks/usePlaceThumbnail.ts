import { useEffect, useState } from 'react';
import type { UnifiedSearchResult } from '../services/search/unifiedSearch';
import {
  getCachedPlaceThumbnail,
  placeThumbnailSource,
  resolvePlaceThumbnail,
} from '../services/places/placeThumbnailService';

/**
 * Delay before a mounted row starts resolving a photo. Long enough that a fast
 * scroll doesn't kick off a request for a row the user never looked at.
 */
const RESOLVE_DELAY_MS = 150;

/**
 * Lazily resolve the thumbnail for a search result.
 *
 * Cache hits paint on the first render (MMKV reads are synchronous); misses are
 * resolved in the background after the row has been on screen briefly. Returns
 * null when the place has no known photo source, so callers can fall back to a
 * category icon.
 */
export function usePlaceThumbnail(result: UnifiedSearchResult): string | null {
  const tags = result.poi?.tags;
  const explicit = result.thumbnailUrl ?? null;
  const cacheKey = tags ? (placeThumbnailSource(tags)?.key ?? null) : null;

  const [url, setUrl] = useState<string | null>(
    () => explicit ?? (tags ? getCachedPlaceThumbnail(tags) : null),
  );

  useEffect(() => {
    if (explicit) {
      setUrl(explicit);
      return undefined;
    }
    if (!tags || !cacheKey) {
      setUrl(null);
      return undefined;
    }

    const cached = getCachedPlaceThumbnail(tags);
    if (cached) {
      setUrl(cached);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void resolvePlaceThumbnail(tags).then((resolved) => {
        if (!cancelled) setUrl(resolved);
      });
    }, RESOLVE_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cacheKey, explicit, tags]);

  return url;
}
