/**
 * Search session unit tests.
 *
 * The session owns debounce, abort-on-new-input, the immediate local pass,
 * and generation checks. `unifiedSearch` is mocked so lifecycle behavior is
 * asserted without native modules.
 */

jest.mock('../../src/services/search/unifiedSearch', () => ({
  unifiedSearch: jest.fn(),
}));

import { createSearchSession } from '../../src/services/search/searchSession';
import { unifiedSearch } from '../../src/services/search/unifiedSearch';
import type { UnifiedSearchResult } from '../../src/services/search/unifiedSearch';

const mockSearch = unifiedSearch as jest.MockedFunction<typeof unifiedSearch>;

function makeResult(name: string): UnifiedSearchResult {
  return {
    name,
    subtitle: '',
    lat: 40.74,
    lng: -73.98,
    type: 'poi',
    score: 80,
    distanceKm: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const context = { lat: 40.748, lng: -73.985, zoom: 14 };

describe('createSearchSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    mockSearch.mockImplementation(async (query, opts) =>
      opts?.localOnly ? [makeResult(`local:${query}`)] : [makeResult(`full:${query}`)],
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits local results immediately and the full merge after the debounce', async () => {
    const onResults = jest.fn();
    const session = createSearchSession({ getContext: () => context, onResults, debounceMs: 50 });

    session.search('coffee');
    await jest.advanceTimersByTimeAsync(0);

    expect(onResults).toHaveBeenCalledWith([makeResult('local:coffee')], {
      query: 'coffee',
      source: 'local',
      final: false,
    });
    expect(mockSearch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(50);

    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(onResults).toHaveBeenLastCalledWith([makeResult('full:coffee')], {
      query: 'coffee',
      source: 'full',
      final: true,
    });
  });

  it('aborts the in-flight network search when a new input supersedes it', async () => {
    const pending = deferred<UnifiedSearchResult[]>();
    let fullSignal: AbortSignal | undefined;
    mockSearch.mockImplementation(async (query, opts) => {
      if (opts?.localOnly) return [makeResult(`local:${query}`)];
      fullSignal = opts?.signal ?? undefined;
      return pending.promise;
    });

    const onResults = jest.fn();
    const session = createSearchSession({ getContext: () => context, onResults, debounceMs: 50 });

    session.search('coffee');
    await jest.advanceTimersByTimeAsync(50);
    expect(fullSignal).toBeDefined();
    expect(fullSignal?.aborted).toBe(false);

    session.search('tea');
    expect(fullSignal?.aborted).toBe(true);

    await jest.advanceTimersByTimeAsync(50);
    expect(onResults).toHaveBeenLastCalledWith([makeResult('local:tea')], {
      query: 'tea',
      source: 'local',
      final: false,
    });
  });

  it('never emits results from a superseded local pass', async () => {
    const firstLocal = deferred<UnifiedSearchResult[]>();
    mockSearch.mockImplementation(async (query, opts) => {
      if (opts?.localOnly && query === 'cof') return firstLocal.promise;
      if (opts?.localOnly) return [makeResult(`local:${query}`)];
      return [makeResult(`full:${query}`)];
    });

    const onResults = jest.fn();
    const session = createSearchSession({ getContext: () => context, onResults, debounceMs: 50 });

    session.search('cof');
    session.search('coffee');
    firstLocal.resolve([makeResult('local:cof')]);
    await jest.advanceTimersByTimeAsync(0);

    const emittedNames = onResults.mock.calls.flatMap(([results]) =>
      (results as UnifiedSearchResult[]).map((r) => r.name),
    );
    expect(emittedNames).not.toContain('local:cof');
  });

  it('submit bypasses the debounce and returns the final results', async () => {
    const onResults = jest.fn();
    const session = createSearchSession({ getContext: () => context, onResults, debounceMs: 50 });

    const results = await session.submit('pizza');

    expect(results).toEqual([makeResult('full:pizza')]);
    expect(onResults).toHaveBeenLastCalledWith([makeResult('full:pizza')], {
      query: 'pizza',
      source: 'full',
      final: true,
    });
  });

  it('coalesces rapid successive inputs into a single full search', async () => {
    const onResults = jest.fn();
    const session = createSearchSession({ getContext: () => context, onResults, debounceMs: 50 });

    session.search('stan');
    session.search('starb');
    session.search('starbucks');
    await jest.advanceTimersByTimeAsync(50);

    const fullCalls = mockSearch.mock.calls.filter(([, opts]) => !opts?.localOnly);
    expect(fullCalls).toHaveLength(1);
    expect(fullCalls[0][0]).toBe('starbucks');
  });

  it('clears results for queries shorter than the minimum and never searches', () => {
    const onResults = jest.fn();
    const session = createSearchSession({ getContext: () => context, onResults });

    session.search('a');

    expect(mockSearch).not.toHaveBeenCalled();
    expect(onResults).toHaveBeenCalledWith([], { query: 'a', source: 'local', final: true });
  });

  it('skips the search when transformQuery resolves coordinates', async () => {
    const onTransformed = jest.fn();
    const onResults = jest.fn();
    const session = createSearchSession({
      getContext: () => context,
      onResults,
      onTransformed,
      transformQuery: async () => ({ lat: 1, lng: 2 }),
    });

    session.search('40.748, -73.985');
    await jest.advanceTimersByTimeAsync(0);

    expect(onTransformed).toHaveBeenCalledWith({ lat: 1, lng: 2 }, '40.748, -73.985');
    expect(mockSearch).not.toHaveBeenCalled();
    expect(onResults).toHaveBeenLastCalledWith([], {
      query: '40.748, -73.985',
      source: 'local',
      final: true,
    });
  });
});
