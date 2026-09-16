/**
 * Shared search session.
 *
 * Owns the keystroke lifecycle that was previously duplicated (and partly
 * missing) across consumers: debounce, abort-on-new-input, an immediate
 * local-only pass, and generation checks so superseded results are never
 * applied. React consumers use `usePlaceSearch`; non-React consumers
 * (CarPlay) can use this directly.
 */

import { unifiedSearch, type SearchOptions, type UnifiedSearchResult } from './unifiedSearch';
import { isAbortError } from './abortUtils';

export interface SearchContext {
  lat: number;
  lng: number;
  zoom: number;
  viewportBounds?: SearchOptions['viewportBounds'];
  userLocation?: SearchOptions['userLocation'];
}

export interface SearchStageMeta {
  /** The query that produced these results. */
  query: string;
  /** `local` for local-only/partial emissions, `full` for the network merge. */
  source: 'local' | 'full';
  /** True when no further emissions will occur for this query. */
  final: boolean;
}

export interface SearchSessionOptions {
  /** Resolve the current map/reference context at search time. */
  getContext: () => SearchContext;
  /** Called on every emission (local pass, full partial, final). */
  onResults: (results: UnifiedSearchResult[], meta: SearchStageMeta) => void;
  onError?: (error: unknown) => void;
  /** Debounce before the network phase. Default 300 ms. */
  debounceMs?: number;
  /** Maximum results per search. Default 30. */
  limit?: number;
  /** Run the local-only pass immediately on `search()`. Default true. */
  localFirst?: boolean;
  /** Queries shorter than this clear results without searching. Default 2. */
  minQueryLength?: number;
  /** Optional pre-flight (e.g. coordinate/Plus Code detection). When it
   *  returns coordinates, the search is skipped and `onTransformed` fires. */
  transformQuery?: (query: string) => Promise<{ lat: number; lng: number } | null>;
  onTransformed?: (coords: { lat: number; lng: number }, query: string) => void;
}

export interface SearchSession {
  /** Handle a new input value: immediate local pass (optionally), debounced full search. */
  search(query: string): void;
  /** Run the full search immediately, bypassing the debounce. Returns final results. */
  submit(query?: string): Promise<UnifiedSearchResult[]>;
  /** Re-run the last query immediately (e.g. after the viewport moved). */
  refetch(): void;
  /** Abort any in-flight work and ignore pending results. */
  cancel(): void;
  /** Cancel and release resources permanently. */
  dispose(): void;
  /** The most recent raw query passed to `search`/`submit`. */
  getLastQuery(): string;
}

export function createSearchSession(options: SearchSessionOptions): SearchSession {
  const {
    getContext,
    onResults,
    onError,
    debounceMs = 300,
    limit = 30,
    localFirst = true,
    minQueryLength = 2,
    transformQuery,
    onTransformed,
  } = options;

  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let networkController: AbortController | null = null;
  let localController: AbortController | null = null;
  let lastQuery = '';
  let disposed = false;

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function abortInFlight(): void {
    clearDebounce();
    networkController?.abort();
    networkController = null;
    localController?.abort();
    localController = null;
  }

  function buildOptions(signal: AbortSignal, onStage?: SearchOptions['onStage']): SearchOptions {
    const context = getContext();
    return {
      lat: context.lat,
      lng: context.lng,
      zoom: context.zoom,
      viewportBounds: context.viewportBounds,
      userLocation: context.userLocation,
      limit,
      signal,
      onStage,
    };
  }

  async function runLocal(query: string, gen: number): Promise<void> {
    if (!localFirst) return;
    const controller = new AbortController();
    localController = controller;
    try {
      const results = await unifiedSearch(query, {
        ...buildOptions(controller.signal),
        localOnly: true,
      });
      if (gen !== generation || disposed) return;
      onResults(results, { query, source: 'local', final: false });
    } catch (err) {
      if (!isAbortError(err) && gen === generation && !disposed) onError?.(err);
    } finally {
      if (localController === controller) localController = null;
    }
  }

  async function runFull(query: string, gen: number): Promise<UnifiedSearchResult[]> {
    const controller = new AbortController();
    networkController = controller;
    try {
      const results = await unifiedSearch(
        query,
        buildOptions(controller.signal, (partial, meta) => {
          if (gen !== generation || disposed || meta.final) return;
          onResults(partial, {
            query,
            source: meta.stage === 'local' ? 'local' : 'full',
            final: false,
          });
        }),
      );
      if (gen !== generation || disposed) return [];
      onResults(results, { query, source: 'full', final: true });
      return results;
    } catch (err) {
      if (!isAbortError(err) && gen === generation && !disposed) onError?.(err);
      return [];
    } finally {
      if (networkController === controller) networkController = null;
    }
  }

  function scheduleFull(query: string, gen: number): void {
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runFull(query, gen);
    }, debounceMs);
  }

  function search(query: string): void {
    if (disposed) return;
    lastQuery = query;
    const trimmed = query.trim();
    const gen = ++generation;
    abortInFlight();

    if (trimmed.length < minQueryLength) {
      onResults([], { query: trimmed, source: 'local', final: true });
      return;
    }

    if (!transformQuery) {
      void runLocal(trimmed, gen);
      scheduleFull(trimmed, gen);
      return;
    }

    void (async () => {
      let coords: { lat: number; lng: number } | null = null;
      try {
        coords = await transformQuery(trimmed);
      } catch {
        coords = null;
      }
      if (gen !== generation || disposed) return;
      if (coords) {
        onResults([], { query: trimmed, source: 'local', final: true });
        onTransformed?.(coords, trimmed);
        return;
      }
      void runLocal(trimmed, gen);
      scheduleFull(trimmed, gen);
    })();
  }

  function submit(query?: string): Promise<UnifiedSearchResult[]> {
    if (disposed) return Promise.resolve([]);
    const raw = query ?? lastQuery;
    lastQuery = raw;
    const trimmed = raw.trim();
    const gen = ++generation;
    abortInFlight();

    if (trimmed.length < minQueryLength) {
      onResults([], { query: trimmed, source: 'local', final: true });
      return Promise.resolve([]);
    }

    void runLocal(trimmed, gen);
    return runFull(trimmed, gen);
  }

  function refetch(): void {
    void submit(lastQuery);
  }

  function cancel(): void {
    generation++;
    abortInFlight();
  }

  function dispose(): void {
    disposed = true;
    cancel();
  }

  return {
    search,
    submit,
    refetch,
    cancel,
    dispose,
    getLastQuery: () => lastQuery,
  };
}
