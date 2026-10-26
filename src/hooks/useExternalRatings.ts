/**
 * Controller for external aggregate ratings.
 *
 * Per provider it runs a small state machine: resolve a known listing (explicit
 * tag → website link) and try a plain fetch; if that fails, fall back to the
 * hidden-WebView search stage, then to a listing (fetch first, WebView second).
 * Providers resolve independently and fail silently.
 *
 * Bounded policy: at most one hidden WebView is mounted at a time (enforced by
 * the section), fetches are paced through the shared browse scheduler, and a
 * detected challenge reports back to it so the host cools down. Each WebView
 * stage is bounded by {@link STAGE_TIMEOUT_MS} and each provider's whole
 * pipeline by {@link PROVIDER_BUDGET_MS}, so the card always reaches a settled
 * state (rating or "no ratings yet").
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
  getCachedListing,
  hydrateListingCache,
  setCachedListing,
  type ListingOrigin,
} from '../services/poi/externalRatings/listingCache';
import {
  parsePageVerdict,
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

export const STAGE_TIMEOUT_MS = 8_000;

/**
 * Whole-pipeline budget for a single provider, armed the first time that
 * provider becomes the active one.
 *
 * Stages carry their own (shorter) clocks; this is the backstop that keeps a
 * provider — and therefore the whole pass, since only one hidden WebView is
 * mounted at a time — from stalling on a paced fetch or on a provider that
 * keeps making progress without ever settling. It is deliberately per provider
 * rather than per pass: a provider queued behind another must still get its
 * full turn, and a shared deadline is what previously starved the second
 * provider of every two-stage (search → listing) resolution.
 */
export const PROVIDER_BUDGET_MS = 28_000;

/**
 * Bound on a plain-fetch phase, including the wait in front of it for the shared
 * browse scheduler's per-host pacing. `fetchPageHtml` already aborts its own
 * request after 8 s; this covers the pacing wait (a host cool-down can be
 * minutes), so a fetch-only pipeline still settles even though no WebView stage
 * clock is running for it.
 */
export const FETCH_PHASE_TIMEOUT_MS = 12_000;

/**
 * Resolve `promise` within `ms`, or `null` on timeout/rejection. Never rejects,
 * so callers can treat a stalled phase exactly like a miss.
 */
function withPhaseTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Dev-only stage tracing so on-device runs reveal exactly which step bails. */
function log(...args: unknown[]): void {
  if (__DEV__) console.log('[externalRatings]', ...args);
}

export type ExternalRatingStatus =
  | 'idle'
  | 'searching'
  | 'loading'
  | 'loaded'
  | 'failed'
  | 'blocked';

type Origin = ListingOrigin;

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
  /** When the provider lookup is paused, the earliest retry time (ms epoch). */
  blockedUntil: number | null;
  /** Why the lookup is paused: a provider block or the app's own pacing. */
  blockReason: 'blocked' | 'paced' | null;
}

interface InternalState extends ExternalRatingProviderState {
  origin: Origin;
}

export interface UseExternalRatingsResult {
  states: ExternalRatingProviderState[];
  handleMessage: (provider: ExternalRatingProviderId, data: string) => void;
  handleError: (provider: ExternalRatingProviderId, statusCode?: number) => void;
}

function blankState(provider: ExternalRatingProviderId): InternalState {
  return {
    provider,
    status: 'idle',
    summary: null,
    webView: null,
    listingUrl: null,
    blockedUntil: null,
    blockReason: null,
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
  const budgetRef = useRef<
    Partial<Record<ExternalRatingProviderId, ReturnType<typeof setTimeout>>>
  >({});
  const budgetArmedRef = useRef<Partial<Record<ExternalRatingProviderId, boolean>>>({});

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

  const clearBudget = useCallback((id: ExternalRatingProviderId) => {
    const t = budgetRef.current[id];
    if (t) {
      clearTimeout(t);
      budgetRef.current[id] = undefined;
    }
    budgetArmedRef.current[id] = false;
  }, []);

  /**
   * Settle a provider as having no rating.
   *
   * `kind` decides whether the outcome is remembered for the session:
   *  - `'verdict'` — a provider page actually rendered and answered (challenge,
   *    identity mismatch, no rating data). Worth remembering: re-opening the
   *    card would only repeat the same answer.
   *  - `'retry'` — a timeout, budget, network error, or a search page that
   *    yielded nothing. NOT remembered, so the next card open gets a fresh
   *    attempt instead of a ten-minute dead end.
   */
  const fail = useCallback(
    (id: ExternalRatingProviderId, kind: 'verdict' | 'retry') => {
      if (kind === 'verdict') {
        markExternalRatingMiss(missKeyFor(queryRef.current, id));
        log(id, 'failed — no rating (verdict remembered for the session)');
      } else {
        log(id, 'failed — retryable (nothing learned; will re-attempt on reopen)');
      }
      clearBudget(id);
      update(id, { status: 'failed', webView: null });
    },
    [clearBudget, update],
  );

  /**
   * Settle a provider as host-blocked. Unlike a verdict this is not remembered
   * per place: the block belongs to the host and expires on its own, so every
   * place gets the same honest "blocked" state without a page load.
   */
  const blockProvider = useCallback(
    (id: ExternalRatingProviderId, retryAt: number, reason: 'blocked' | 'paced') => {
      clearBudget(id);
      clearTimer(id);
      log(id, `${reason} — pausing provider until`, new Date(retryAt).toISOString());
      update(id, { status: 'blocked', webView: null, blockedUntil: retryAt, blockReason: reason });
    },
    [clearBudget, clearTimer, update],
  );

  const armTimeout = useCallback(
    (id: ExternalRatingProviderId) => {
      clearTimer(id);
      timerRef.current[id] = setTimeout(() => {
        // A provider that already produced a summary is settled: never let a
        // stale stage timeout wipe a loaded row.
        const current = statesRef.current.find((s) => s.provider === id);
        if (current?.status === 'loaded') return;
        fail(id, 'retry');
      }, STAGE_TIMEOUT_MS);
    },
    [clearTimer, fail],
  );

  /**
   * Backstop for a provider's whole pipeline. Armed once, the first time the
   * provider becomes active, so a queued provider never burns its budget while
   * another holds the single hidden-WebView slot.
   */
  const armBudget = useCallback(
    (id: ExternalRatingProviderId) => {
      if (budgetArmedRef.current[id]) return;
      budgetArmedRef.current[id] = true;
      budgetRef.current[id] = setTimeout(() => {
        const current = statesRef.current.find((s) => s.provider === id);
        if (current?.status === 'loaded' || current?.status === 'failed') return;
        log(id, 'provider budget elapsed — giving up');
        clearTimer(id);
        fail(id, 'retry');
      }, PROVIDER_BUDGET_MS);
    },
    [clearTimer, fail],
  );

  useEffect(() => {
    let cancelled = false;
    const q = queryRef.current;

    // A new place: drop every timer from the previous pass so no stale stage or
    // budget clock can settle the new resolution.
    EXTERNAL_RATING_PROVIDERS.forEach(({ id }) => {
      clearTimer(id);
      clearBudget(id);
    });

    EXTERNAL_RATING_PROVIDERS.forEach((provider) => {
      const id = provider.id;
      const explicitTag = q.tags?.[`polaris:${id}`];
      log(id, 'resolve start', {
        hasTag: !!explicitTag,
        hasWebsite: !!q.website,
        address: q.address ?? null,
        name: q.name,
      });

      // A new place: reset this provider before re-resolving.
      update(id, blankState(id));

      // Already settled with no rating this session: skip the whole pipeline.
      if (isExternalRatingMiss(missKeyFor(q, id))) {
        update(id, { status: 'failed' });
        return;
      }

      void (async () => {
        // Hydration runs in the background: a slow or unavailable disk must
        // never hold the ratings row open. The module already started this at
        // import time; this call only joins an in-flight load.
        void hydrateListingCache();
        if (cancelled) return;

        const placeKey = placeRatingKey(q);
        let listingUrl: string | null = null;
        let origin: Origin = explicitTag ? 'tag' : 'website';

        const cachedListing = getCachedListing(id, placeKey);
        if (cachedListing) {
          listingUrl = cachedListing.url;
          origin = cachedListing.origin;
        } else {
          try {
            listingUrl = await resolveKnownListing(provider, q);
          } catch {
            listingUrl = null;
          }
          if (listingUrl) setCachedListing(id, placeKey, listingUrl, origin);
        }
        if (cancelled) return;
        log(id, listingUrl ? `known listing (${origin})` : 'no known listing', listingUrl ?? '');

        /**
         * Open a provider page after acquiring a paced page-load slot.
         * A refresh/new place is paced; search → listing continuations are not
         * (they are an in-site click, not a new browsing chain).
         */
        const openStage = async (
          stage: 'search' | 'listing',
          uri: string,
          stageOrigin: Origin,
        ): Promise<void> => {
          const decision = await browseScheduler.acquirePageLoad(hostOf(uri));
          if (cancelled) return;
          if (!decision.ok) {
            if (decision.reason === 'blocked') {
              blockProvider(id, decision.retryAt ?? Date.now() + 2 * 60 * 60 * 1000, 'blocked');
            } else {
              log(id, 'page load deferred', decision.reason, decision.retryAt ?? 0);
              blockProvider(id, decision.retryAt ?? Date.now() + 5 * 60_000, 'paced');
            }
            return;
          }
          update(id, {
            status: stage === 'search' ? 'searching' : 'loading',
            origin: stageOrigin,
            listingUrl: stage === 'listing' ? uri : null,
            webView: {
              provider: id,
              uri,
              injectedJavaScript: stage === 'search' ? provider.searchJs : provider.listingJs,
              stage,
            },
          });
        };

        if (listingUrl) {
          // Opt-in fetch path; both current providers are browser-only.
          if (provider.supportsPlainFetch) {
            const summary = await withPhaseTimeout(
              paceFetch(listingUrl, () => fetchAndParseRating(provider, listingUrl as string, q)),
              FETCH_PHASE_TIMEOUT_MS,
            );
            if (cancelled) return;
            if (summary) {
              log(id, 'fetch hit', summary.rating, summary.reviewCount);
              clearBudget(id);
              update(id, { status: 'loaded', summary, listingUrl, webView: null, origin });
              return;
            }
            log(id, 'fetch miss → WebView listing', listingUrl);
          } else {
            log(id, 'browser-only listing → WebView', listingUrl);
          }
          await openStage('listing', listingUrl, origin);
          return;
        }

        const searchUrl = provider.buildSearchUrl(q.name, q.address ?? null);
        log(id, 'search', searchUrl);
        await openStage('search', searchUrl, 'search');
      })();
    });

    return () => {
      cancelled = true;
      Object.values(timerRef.current).forEach((t) => t && clearTimeout(t));
      Object.values(budgetRef.current).forEach((t) => t && clearTimeout(t));
    };
    // Resolution is keyed to the place (`resetKey`), not to every query field,
    // so late enrichment can't reset an already-loaded rating.
  }, [resetKey, update, clearTimer, clearBudget, fail, blockProvider]);

  // The section mounts at most one hidden WebView at a time — the first provider
  // (registry order) exposing a stage. A stage's clock must start when its
  // WebView actually mounts, not when it was scheduled; otherwise a provider
  // queued behind another provider's stage counts down while it is not on
  // screen and can time out before its page ever loads.
  const activeProvider = states.find((s) => s.webView)?.provider ?? null;
  useEffect(() => {
    if (activeProvider == null) return;
    log(activeProvider, 'stage active — clock started');
    armBudget(activeProvider);
    armTimeout(activeProvider);
    return () => clearTimer(activeProvider);
  }, [activeProvider, armBudget, armTimeout, clearTimer]);

  const handleMessage = useCallback(
    (id: ExternalRatingProviderId, data: string) => {
      const current = statesRef.current.find((s) => s.provider === id);
      if (!current || !current.webView) return;
      const provider = providerById(id);
      const q = queryRef.current;

      if (current.webView.stage === 'search') {
        // A blocked or challenged search page carries no candidates; classify
        // it before the empty-result path so the host backs off instead of
        // being retried on the next card.
        const verdict = parsePageVerdict(data);
        if (verdict.blocked) {
          const host = hostOf(current.webView.uri);
          browseScheduler.reportBlocked(host);
          blockProvider(id, Date.now() + browseScheduler.blockedRemainingMs(host), 'blocked');
          return;
        }
        if (verdict.challenge) {
          const host = hostOf(current.webView.uri);
          browseScheduler.reportChallenge(host);
          clearTimer(id);
          log(id, 'search challenge detected', host);
          fail(id, 'verdict');
          return;
        }

        const candidates = candidatesFromSearchMessage(provider, data);
        const chosen = selectSearchCandidate(candidates, q);
        log(
          id,
          'search results',
          candidates.length,
          chosen
            ? {
                name: chosen.name,
                url: chosen.url,
                hasRating: chosen.rating != null,
                hasGeo: !!chosen.geo,
                hasAddress: !!chosen.address,
              }
            : 'no candidate matched',
        );
        if (!chosen) {
          // The search page is a JS app: an empty result is not a verdict we can
          // trust, so leave the provider retryable for the next card open.
          clearTimer(id);
          fail(id, 'retry');
          return;
        }

        if (!provider.isProviderUrl(chosen.url)) {
          clearTimer(id);
          log(id, 'candidate left the provider allowlist', chosen.url);
          fail(id, 'retry');
          return;
        }

        // Inline answer: the search card itself carried rating + count and a
        // confirmation signal, so no listing navigation is needed.
        if (
          chosen.rating != null &&
          chosen.reviewCount != null &&
          (chosen.geo || chosen.address) &&
          matchIdentity(chosen, q)
        ) {
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
            setCachedListing(id, placeRatingKey(q), inlineListingUrl, 'search');
            setCachedExternalRating(id, inlineListingUrl, summary);
            clearTimer(id);
            clearBudget(id);
            log(id, 'loaded (inline search card)', summary.rating, summary.reviewCount);
            update(id, { status: 'loaded', summary, listingUrl: inlineListingUrl, webView: null });
            return;
          }
        }

        // Remember the listing this search confirmed so the next visit skips
        // the search page entirely.
        clearTimer(id);
        setCachedListing(id, placeRatingKey(q), chosen.url, 'search');

        // Browser-only providers go straight to the listing: a plain fetch of
        // them is a guaranteed 403 and only adds a bot signature.
        if (!provider.supportsPlainFetch) {
          log(id, 'browser-only listing (search) → WebView', chosen.url);
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

        // Fetch-first is opt-in (`supportsPlainFetch`); no current provider sets
        // it. Identity would be re-confirmed from the listing's own
        // address/`geo`, so a sibling chain branch would still be rejected even
        // though the candidate came from a search.
        update(id, {
          status: 'loading',
          listingUrl: chosen.url,
          origin: 'search',
          webView: null,
        });
        void (async () => {
          const summary = await withPhaseTimeout(
            paceFetch(chosen.url, () =>
              fetchAndParseRating(provider, chosen.url, q, { confirmIdentity: true }),
            ),
            FETCH_PHASE_TIMEOUT_MS,
          );
          // Apply only if this provider is still resolving the same candidate.
          const latest = statesRef.current.find((s) => s.provider === id);
          if (
            !latest ||
            latest.status !== 'loading' ||
            latest.listingUrl !== chosen.url ||
            latest.webView
          ) {
            return;
          }
          if (summary) {
            clearBudget(id);
            log(id, 'loaded (search → fetch)', summary.rating, summary.reviewCount, chosen.url);
            update(id, { status: 'loaded', summary, listingUrl: chosen.url, webView: null });
            return;
          }
          // The fetch was challenged or empty — fall back to the WebView stage.
          armTimeout(id);
          log(id, 'fetch miss → WebView listing (search)', chosen.url);
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
        })();
        return;
      }

      const raw = provider.parseRatingMessage(data);
      if (!raw) return;

      // A terminal block page is a host-wide verdict, not a per-place one:
      // persist it so no later card (in this launch or the next) retries into
      // the same wall.
      if (raw.blocked) {
        const host = hostOf(current.webView.uri);
        browseScheduler.reportBlocked(host);
        blockProvider(id, Date.now() + browseScheduler.blockedRemainingMs(host), 'blocked');
        return;
      }

      if (raw.challenge) {
        browseScheduler.reportChallenge(hostOf(current.webView.uri));
        clearTimer(id);
        log(id, 'challenge detected', hostOf(current.webView.uri));
        fail(id, 'verdict');
        return;
      }

      if (current.origin === 'search') {
        const confirmed = matchIdentity(
          { name: raw.listingName, address: raw.listingAddress, geo: raw.geo ?? null },
          q,
        );
        if (!confirmed) {
          clearTimer(id);
          log(id, 'identity mismatch on listing', {
            listingName: raw.listingName,
            listingAddress: raw.listingAddress,
            hasGeo: !!raw.geo,
          });
          fail(id, 'verdict');
          return;
        }
      }

      const listingUrl = current.listingUrl ?? current.webView.uri;
      const summary = validateExternalRating(raw, listingUrl, id, { expectedName: q.name });
      if (!summary) {
        clearTimer(id);
        log(id, 'validation failed', {
          rating: raw.rating,
          reviewCount: raw.reviewCount,
          listingName: raw.listingName,
        });
        fail(id, 'verdict');
        return;
      }
      setCachedExternalRating(id, listingUrl, summary);
      clearTimer(id);
      clearBudget(id);
      log(id, 'loaded', summary.rating, summary.reviewCount, listingUrl);
      update(id, { status: 'loaded', summary, webView: null });
    },
    [armTimeout, blockProvider, clearBudget, clearTimer, fail],
  );

  const handleError = useCallback(
    (id: ExternalRatingProviderId, statusCode?: number) => {
      const current = statesRef.current.find((s) => s.provider === id);
      if (current?.webView) {
        const host = hostOf(current.webView.uri);
        // A 403/429 is the provider's edge refusing this device, not a network
        // hiccup: 403 escalates the challenge cool-down, 429 waits a minute.
        if (statusCode === 403) {
          browseScheduler.reportChallenge(host);
        } else if (statusCode === 429) {
          browseScheduler.reportRateLimited(host, 60_000);
        } else {
          browseScheduler.reportRateLimited(host, 0);
        }
        log(id, 'webview error', host, statusCode ?? 'network');
      }
      clearTimer(id);
      fail(id, 'retry');
    },
    [clearTimer, fail],
  );

  const publicStates = useMemo<ExternalRatingProviderState[]>(
    () =>
      states.map(
        ({ provider, status, summary, webView, listingUrl, blockedUntil, blockReason }) => ({
          provider,
          status,
          summary,
          webView,
          listingUrl,
          blockedUntil,
          blockReason,
        }),
      ),
    [states],
  );

  return { states: publicStates, handleMessage, handleError };
}
