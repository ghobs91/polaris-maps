/**
 * Controller for external aggregate ratings.
 *
 * Per provider it runs a small state machine: resolve a known listing (explicit
 * tag → website link) and try a plain fetch; if that fails, fall back to the
 * hidden-WebView search stage, then the listing stage. Providers resolve
 * independently and fail silently.
 *
 * Bounded policy: at most one hidden WebView is mounted at a time (enforced by
 * the section), fetches are paced through the shared browse scheduler, and a
 * detected challenge reports back to it so the host cools down.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXTERNAL_RATING_PROVIDERS,
  candidatesFromSearchMessage,
  fetchAndParseRating,
  providerById,
  resolveKnownListing,
  selectSearchCandidate,
} from '../services/poi/externalRatings';
import { browseScheduler } from '../services/poi/externalRatings/antiBot';
import {
  setCachedExternalRating,
  validateExternalRating,
} from '../services/poi/externalRatings/core';
import { matchIdentity } from '../services/poi/identity';
import {
  isExternalRatingMiss,
  markExternalRatingMiss,
  placeRatingKey,
} from '../services/places/placeRatingSessionCache';
import type {
  ExternalRatingProviderId,
  ExternalRatingQuery,
  ExternalRatingSummary,
} from '../services/poi/externalRatings/types';

export const STAGE_TIMEOUT_MS = 20_000;

export type ExternalRatingStatus = 'idle' | 'searching' | 'loading' | 'loaded' | 'failed';

type Origin = 'tag' | 'website' | 'search';

export interface ExternalRatingWebViewStage {
  provider: ExternalRatingProviderId;
  uri: string;
  injectedJavaScript: string;
  stage: 'search' | 'listing';
}

export interface ExternalRatingProviderState {
  provider: ExternalRatingProviderId;
  status: ExternalRatingStatus;
  summary: ExternalRatingSummary | null;
  webView: ExternalRatingWebViewStage | null;
  listingUrl: string | null;
}

interface InternalState extends ExternalRatingProviderState {
  origin: Origin;
}

export interface UseExternalRatingsResult {
  states: ExternalRatingProviderState[];
  handleMessage: (provider: ExternalRatingProviderId, data: string) => void;
  handleError: (provider: ExternalRatingProviderId) => void;
}

function blankState(provider: ExternalRatingProviderId): InternalState {
  return {
    provider,
    status: 'idle',
    summary: null,
    webView: null,
    listingUrl: null,
    origin: 'website',
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Stable session key for a provider's resolved-to-nothing state on a place. */
function missKeyFor(query: ExternalRatingQuery, provider: ExternalRatingProviderId): string {
  return `${provider}:${placeRatingKey(query)}`;
}

function paceFetch<T>(url: string, task: () => Promise<T>): Promise<T> {
  const host = hostOf(url);
  if (browseScheduler.isCoolingDown(host)) {
    return Promise.reject(new Error('host cooling down'));
  }
  return browseScheduler.schedule(host, task);
}

export function useExternalRatings(
  query: ExternalRatingQuery,
  resetKey: string | number,
): UseExternalRatingsResult {
  const [states, setStates] = useState<InternalState[]>(() =>
    EXTERNAL_RATING_PROVIDERS.map((p) => blankState(p.id)),
  );

  const queryRef = useRef(query);
  queryRef.current = query;
  const statesRef = useRef(states);
  statesRef.current = states;
  const timerRef = useRef<Partial<Record<ExternalRatingProviderId, ReturnType<typeof setTimeout>>>>(
    {},
  );

  const update = useCallback((id: ExternalRatingProviderId, patch: Partial<InternalState>) => {
    setStates((prev) => prev.map((s) => (s.provider === id ? { ...s, ...patch } : s)));
  }, []);

  const clearTimer = useCallback((id: ExternalRatingProviderId) => {
    const t = timerRef.current[id];
    if (t) {
      clearTimeout(t);
      timerRef.current[id] = undefined;
    }
  }, []);

  const fail = useCallback(
    (id: ExternalRatingProviderId) => {
      // Remember the miss for the session so re-opening the card skips the whole
      // browse pipeline for this provider. TTL-bounded and in-memory only, like
      // the ratings themselves.
      markExternalRatingMiss(missKeyFor(queryRef.current, id));
      update(id, { status: 'failed', webView: null });
    },
    [update],
  );

  const armTimeout = useCallback(
    (id: ExternalRatingProviderId) => {
      clearTimer(id);
      timerRef.current[id] = setTimeout(() => {
        // A provider that already produced a summary is settled: never let a
        // stale stage timeout wipe a loaded row.
        const current = statesRef.current.find((s) => s.provider === id);
        if (current?.status === 'loaded') return;
        fail(id);
      }, STAGE_TIMEOUT_MS);
    },
    [clearTimer, fail],
  );

  useEffect(() => {
    let cancelled = false;
    const q = queryRef.current;

    EXTERNAL_RATING_PROVIDERS.forEach((provider) => {
      const id = provider.id;
      const explicitTag = q.tags?.[`polaris:${id}`];

      // A new place: reset this provider before re-resolving.
      update(id, blankState(id));

      // Already settled with no rating this session: skip the whole pipeline.
      if (isExternalRatingMiss(missKeyFor(q, id))) {
        update(id, { status: 'failed' });
        return;
      }

      void (async () => {
        let listingUrl: string | null = null;
        let origin: Origin = explicitTag ? 'tag' : 'website';
        try {
          listingUrl = await resolveKnownListing(provider, q);
        } catch {
          listingUrl = null;
        }
        if (cancelled) return;

        if (listingUrl) {
          let summary: ExternalRatingSummary | null = null;
          try {
            summary = await paceFetch(listingUrl, () =>
              fetchAndParseRating(provider, listingUrl as string, q),
            );
          } catch {
            summary = null;
          }
          if (cancelled) return;
          if (summary) {
            update(id, { status: 'loaded', summary, listingUrl, webView: null, origin });
            return;
          }
          armTimeout(id);
          update(id, {
            status: 'loading',
            listingUrl,
            origin,
            webView: {
              provider: id,
              uri: listingUrl,
              injectedJavaScript: provider.listingJs,
              stage: 'listing',
            },
          });
          return;
        }

        const searchUrl = provider.buildSearchUrl(q.name, q.address ?? null);
        armTimeout(id);
        update(id, {
          status: 'searching',
          origin: 'search',
          listingUrl: null,
          webView: {
            provider: id,
            uri: searchUrl,
            injectedJavaScript: provider.searchJs,
            stage: 'search',
          },
        });
      })();
    });

    return () => {
      cancelled = true;
      Object.values(timerRef.current).forEach((t) => t && clearTimeout(t));
    };
    // Resolution is keyed to the place (`resetKey`), not to every query field,
    // so late enrichment can't reset an already-loaded rating.
  }, [resetKey, update, armTimeout]);

  const handleMessage = useCallback(
    (id: ExternalRatingProviderId, data: string) => {
      const current = statesRef.current.find((s) => s.provider === id);
      if (!current || !current.webView) return;
      const provider = providerById(id);
      const q = queryRef.current;

      if (current.webView.stage === 'search') {
        const candidates = candidatesFromSearchMessage(provider, data);
        const chosen = selectSearchCandidate(candidates, q);
        if (!chosen) {
          clearTimer(id);
          fail(id);
          return;
        }

        // Inline answer: the search card itself carried rating + count and a
        // confirmation signal, so no listing navigation is needed.
        if (chosen.rating != null && chosen.reviewCount != null && (chosen.geo || chosen.address)) {
          if (!matchIdentity(chosen, q)) {
            clearTimer(id);
            fail(id);
            return;
          }
          const inlineListingUrl = provider.parseListingUrl(chosen.url) ?? chosen.url;
          const summary = validateExternalRating(
            {
              rating: chosen.rating,
              reviewCount: chosen.reviewCount,
              listingName: chosen.name,
              listingAddress: chosen.address,
              geo: chosen.geo ?? null,
              challenge: false,
            },
            inlineListingUrl,
            id,
            { expectedName: q.name },
          );
          if (summary) {
            setCachedExternalRating(id, inlineListingUrl, summary);
            clearTimer(id);
            update(id, { status: 'loaded', summary, listingUrl: inlineListingUrl, webView: null });
            return;
          }
        }

        armTimeout(id);
        update(id, {
          status: 'loading',
          listingUrl: chosen.url,
          origin: 'search',
          webView: {
            provider: id,
            uri: chosen.url,
            injectedJavaScript: provider.listingJs,
            stage: 'listing',
          },
        });
        return;
      }

      const raw = provider.parseRatingMessage(data);
      if (!raw) return;

      if (raw.challenge) {
        browseScheduler.reportChallenge(hostOf(current.webView.uri));
        clearTimer(id);
        fail(id);
        return;
      }

      if (current.origin === 'search') {
        const confirmed = matchIdentity(
          { name: raw.listingName, address: raw.listingAddress, geo: raw.geo ?? null },
          q,
        );
        if (!confirmed) {
          clearTimer(id);
          fail(id);
          return;
        }
      }

      const listingUrl = current.listingUrl ?? current.webView.uri;
      const summary = validateExternalRating(raw, listingUrl, id, { expectedName: q.name });
      if (!summary) {
        clearTimer(id);
        fail(id);
        return;
      }
      setCachedExternalRating(id, listingUrl, summary);
      clearTimer(id);
      update(id, { status: 'loaded', summary, webView: null });
    },
    [armTimeout, clearTimer, fail],
  );

  const handleError = useCallback(
    (id: ExternalRatingProviderId) => {
      const current = statesRef.current.find((s) => s.provider === id);
      if (current?.webView) {
        browseScheduler.reportRateLimited(hostOf(current.webView.uri), 0);
      }
      clearTimer(id);
      fail(id);
    },
    [clearTimer, fail],
  );

  const publicStates = useMemo<ExternalRatingProviderState[]>(
    () =>
      states.map(({ provider, status, summary, webView, listingUrl }) => ({
        provider,
        status,
        summary,
        webView,
        listingUrl,
      })),
    [states],
  );

  return { states: publicStates, handleMessage, handleError };
}
