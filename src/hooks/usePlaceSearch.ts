/**
 * React wrapper around the shared search session.
 *
 * Provides input state, results, and a loading flag while owning the
 * debounce/abort/local-first behavior in `createSearchSession`. All search
 * consumers should use this so keystroke handling stays consistent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSearchSession,
  type SearchSession,
  type SearchStageMeta,
  type SearchSessionOptions,
} from '../services/search/searchSession';
import { parseSearchQuery } from '../services/search/queryParser';
import { applyFilters, mergeFilters, sortResults } from '../services/search/searchFilters';
import { useSearchViewStore } from '../stores/searchViewStore';
import type { UnifiedSearchResult } from '../services/search/unifiedSearch';

export type UsePlaceSearchOptions = Omit<SearchSessionOptions, 'onResults'> & {
  /** Optional observation of every emission, in addition to hook state. */
  onResults?: (results: UnifiedSearchResult[], meta: SearchStageMeta) => void;
};

/** Number of results revealed per page. */
const RESULTS_PAGE = 20;

/** Stable identity for a result across re-sorts and re-emissions. */
function canonicalResultKey(result: UnifiedSearchResult): string {
  return result.poi?.id != null
    ? `poi:${result.poi.id}`
    : `${result.name}:${result.lat.toFixed(5)}:${result.lng.toFixed(5)}`;
}

export interface UsePlaceSearchResult {
  /** Current raw input value. */
  query: string;
  /** Update the input and trigger a search (local immediately, network debounced). */
  setQuery: (query: string) => void;
  /** Latest results (staged: local first, then the full merge). */
  results: UnifiedSearchResult[];
  /** The first page of `results`; grows via `loadMore`. */
  visibleResults: UnifiedSearchResult[];
  /** Reveal the next page of results (client-side progressive disclosure). */
  loadMore: () => void;
  /** True while more results can be revealed. */
  hasMore: boolean;
  /** True while any phase of the current query is still running. */
  isSearching: boolean;
  /** Run the full search immediately, bypassing the debounce. */
  submit: (query?: string) => Promise<UnifiedSearchResult[]>;
  /** Re-run the last query immediately (e.g. after the viewport moved). */
  refetch: () => void;
  /** Abort in-flight work and keep current results. */
  cancel: () => void;
  /** Cancel and clear state. */
  clear: () => void;
}

export function usePlaceSearch(options: UsePlaceSearchOptions): UsePlaceSearchResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [query, setQueryState] = useState('');
  const [rawResults, setRawResults] = useState<UnifiedSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Filters + sort are a pure view layer over the accumulated results: changing
  // them re-applies locally without a refetch (category changes are handled by
  // the caller re-running the search).
  const filters = useSearchViewStore((s) => s.filters);
  const sort = useSearchViewStore((s) => s.sort);
  const results = useMemo(() => {
    const intent = parseSearchQuery(query);
    const effective = mergeFilters(intent, filters);
    const sorted = sortResults(applyFilters(rawResults, effective), sort);
    // Dedupe by canonical key so staggered stage emissions don't repeat rows.
    const seen = new Set<string>();
    return sorted.filter((result) => {
      const key = canonicalResultKey(result);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rawResults, filters, sort, query]);

  // Progressive disclosure: reveal results a page at a time; reset on new query.
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE);
  useEffect(() => {
    setVisibleCount(RESULTS_PAGE);
  }, [query]);
  const visibleResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const loadMore = useCallback(() => setVisibleCount((count) => count + RESULTS_PAGE), []);
  const hasMore = visibleCount < results.length;

  // Throttle staged emissions to one UI update per animation frame so rapid
  // stage completions (local → photon → category → remaining) don't thrash
  // the results list.
  const pendingEmissionRef = useRef<{
    results: UnifiedSearchResult[];
    meta: SearchStageMeta;
  } | null>(null);
  const frameCancelRef = useRef<(() => void) | null>(null);

  const scheduleEmissionFlush = useCallback(() => {
    if (frameCancelRef.current) return;
    const handle =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => flushEmission())
        : setTimeout(() => flushEmission(), 16);
    frameCancelRef.current = () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle as number);
      else clearTimeout(handle as ReturnType<typeof setTimeout>);
    };

    function flushEmission() {
      frameCancelRef.current = null;
      const pending = pendingEmissionRef.current;
      pendingEmissionRef.current = null;
      if (!pending) return;
      setRawResults(pending.results);
      setIsSearching(!pending.meta.final);
      optionsRef.current.onResults?.(pending.results, pending.meta);
    }
  }, []);

  const cancelPendingEmission = useCallback(() => {
    frameCancelRef.current?.();
    frameCancelRef.current = null;
    pendingEmissionRef.current = null;
  }, []);

  const sessionRef = useRef<SearchSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createSearchSession({
      getContext: () => optionsRef.current.getContext(),
      debounceMs: optionsRef.current.debounceMs,
      limit: optionsRef.current.limit,
      localFirst: optionsRef.current.localFirst,
      minQueryLength: optionsRef.current.minQueryLength,
      transformQuery: optionsRef.current.transformQuery
        ? (q) => optionsRef.current.transformQuery!(q)
        : undefined,
      onTransformed: (coords, q) => optionsRef.current.onTransformed?.(coords, q),
      onError: (err) => optionsRef.current.onError?.(err),
      onResults: (emitted, meta) => {
        pendingEmissionRef.current = { results: emitted, meta };
        scheduleEmissionFlush();
      },
    });
  }

  useEffect(
    () => () => {
      cancelPendingEmission();
      sessionRef.current?.dispose();
    },
    [cancelPendingEmission],
  );

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    sessionRef.current?.search(next);
  }, []);

  const submit = useCallback((next?: string) => {
    if (next !== undefined) setQueryState(next);
    return sessionRef.current?.submit(next) ?? Promise.resolve([]);
  }, []);

  const refetch = useCallback(() => {
    sessionRef.current?.refetch();
  }, []);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
    cancelPendingEmission();
    setIsSearching(false);
  }, [cancelPendingEmission]);

  const clear = useCallback(() => {
    sessionRef.current?.cancel();
    cancelPendingEmission();
    setQueryState('');
    setRawResults([]);
    setIsSearching(false);
  }, [cancelPendingEmission]);

  return {
    query,
    setQuery,
    results,
    visibleResults,
    loadMore,
    hasMore,
    isSearching,
    submit,
    refetch,
    cancel,
    clear,
  };
}
