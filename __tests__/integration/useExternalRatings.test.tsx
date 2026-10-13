import { act, renderHook } from '@testing-library/react-native';

const mockResolveKnownListing = jest.fn();
const mockFetchAndParseRating = jest.fn();

jest.mock('../../src/services/poi/externalRatings', () => {
  const actual = jest.requireActual('../../src/services/poi/externalRatings');
  return {
    ...actual,
    resolveKnownListing: (...args: unknown[]) => mockResolveKnownListing(...args),
    fetchAndParseRating: (...args: unknown[]) => mockFetchAndParseRating(...args),
  };
});

import {
  FETCH_PHASE_TIMEOUT_MS,
  PROVIDER_BUDGET_MS,
  STAGE_TIMEOUT_MS,
  useExternalRatings,
} from '../../src/hooks/useExternalRatings';
import { browseScheduler } from '../../src/services/poi/externalRatings/antiBot';
import {
  clearSessionPlaceRatings,
  isExternalRatingMiss,
  placeRatingKey,
} from '../../src/services/places/placeRatingSessionCache';
import type { ExternalRatingQuery } from '../../src/services/poi/externalRatings/types';

const QUERY: ExternalRatingQuery = {
  name: 'Foo Bar',
  lat: 40.75,
  lng: -73.99,
  address: null,
  website: null,
  tags: {},
};

const YELP_LISTING = 'https://www.yelp.com/biz/foo-bar';
const TA_LISTING = 'https://www.tripadvisor.com/Restaurant_Review-g1-d1-Review-Foo-Bar.html';

const VALID_PAYLOAD = JSON.stringify({
  type: 'external-rating',
  provider: 'yelp',
  ldRating: 4.2,
  ldCount: 321,
  ldName: 'Foo Bar',
  ldAddress: null,
  geo: null,
  automation: [],
  challenge: false,
});

const CHALLENGE_PAYLOAD = JSON.stringify({
  type: 'external-rating',
  provider: 'tripadvisor',
  ldRating: null,
  ldCount: null,
  ldName: null,
  ldAddress: null,
  geo: null,
  automation: [],
  challenge: true,
});

const SEARCH_PAYLOAD = JSON.stringify({
  type: 'rating-search',
  provider: 'tripadvisor',
  candidates: [{ url: TA_LISTING, name: 'Foo Bar', address: null, geo: null }],
});

const FETCHED_SUMMARY = {
  provider: 'tripadvisor' as const,
  listingUrl: TA_LISTING,
  listingName: 'Foo Bar',
  rating: 4.5,
  reviewCount: 98,
  observedAt: 1_700_000_000_000,
};

const missKey = (provider: 'tripadvisor' | 'yelp') => `${provider}:${placeRatingKey(QUERY)}`;

async function flush(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await Promise.resolve();
  }
}

describe('useExternalRatings timeout lifecycle (regression)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    browseScheduler.reset();
    clearSessionPlaceRatings();
    mockResolveKnownListing.mockReset();
    mockFetchAndParseRating.mockReset();
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'yelp' ? YELP_LISTING : null),
    );
    // Force the WebView stage: the plain fetch yields nothing.
    mockFetchAndParseRating.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a WebView-loaded rating after the stage timeout elapses', async () => {
    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    // Yelp reached the hidden-WebView listing stage.
    expect(result.current.states.find((s) => s.provider === 'yelp')?.webView?.uri).toBe(
      YELP_LISTING,
    );

    // The injected JS posts a valid rating.
    act(() => {
      result.current.handleMessage('yelp', VALID_PAYLOAD);
    });
    expect(result.current.states.find((s) => s.provider === 'yelp')?.status).toBe('loaded');

    // The old bug: this stale stage timeout turned the loaded row into `failed`.
    act(() => {
      jest.advanceTimersByTime(STAGE_TIMEOUT_MS + 5_000);
    });

    const yelp = result.current.states.find((s) => s.provider === 'yelp');
    expect(yelp?.status).toBe('loaded');
    expect(yelp?.summary?.rating).toBe(4.2);
  });

  it('starts a queued provider stage clock only once its WebView mounts', async () => {
    // Both providers have a listing, so both queue a hidden-WebView stage;
    // TripAdvisor (registry order) holds the single slot.
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING : YELP_LISTING),
    );

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.webView?.uri).toBe(
      TA_LISTING,
    );
    expect(result.current.states.find((s) => s.provider === 'yelp')?.webView?.uri).toBe(
      YELP_LISTING,
    );

    // TripAdvisor's stage times out. Yelp was queued behind it the whole time;
    // its clock must not have been running, so it must not be failed.
    act(() => {
      jest.advanceTimersByTime(STAGE_TIMEOUT_MS + 5_000);
    });

    const yelp = result.current.states.find((s) => s.provider === 'yelp');
    expect(yelp?.status).not.toBe('failed');
    expect(yelp?.webView?.uri).toBe(YELP_LISTING);
  });

  it('settles each provider through its own clock instead of one shared deadline', async () => {
    // No known listing for either provider, so both queue a search-stage
    // WebView and only the first ever gets the single hidden WebView slot.
    mockResolveKnownListing.mockResolvedValue(null);

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    // Before any clock fires the row is still resolving.
    expect(result.current.states.some((s) => s.status === 'idle' || s.status === 'searching')).toBe(
      true,
    );

    // TripAdvisor holds the slot and times out.
    act(() => {
      jest.advanceTimersByTime(STAGE_TIMEOUT_MS + 1_000);
    });
    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.status).toBe('failed');

    // Yelp was queued behind it the whole time, so it still gets a full turn
    // rather than being starved by TripAdvisor's budget.
    act(() => {
      jest.advanceTimersByTime(STAGE_TIMEOUT_MS + 1_000);
    });

    expect(result.current.states.every((s) => s.status === 'failed')).toBe(true);
    expect(result.current.states.every((s) => s.webView === null)).toBe(true);
  });

  it('does not wipe an already-loaded provider when its budget elapses', async () => {
    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    act(() => {
      result.current.handleMessage('yelp', VALID_PAYLOAD);
    });
    expect(result.current.states.find((s) => s.provider === 'yelp')?.status).toBe('loaded');

    act(() => {
      jest.advanceTimersByTime(PROVIDER_BUDGET_MS + 1_000);
    });

    const yelp = result.current.states.find((s) => s.provider === 'yelp');
    expect(yelp?.status).toBe('loaded');
    expect(yelp?.summary?.rating).toBe(4.2);
  });

  it('resolves a search-found listing with a plain fetch, not a second WebView stage', async () => {
    mockResolveKnownListing.mockResolvedValue(null);
    mockFetchAndParseRating.mockResolvedValue(FETCHED_SUMMARY);

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    // The search stage reports one candidate.
    act(() => {
      result.current.handleMessage('tripadvisor', SEARCH_PAYLOAD);
    });
    await act(async () => {
      await flush();
    });

    const tripadvisor = result.current.states.find((s) => s.provider === 'tripadvisor');
    expect(tripadvisor?.status).toBe('loaded');
    expect(tripadvisor?.summary?.rating).toBe(4.5);
    expect(tripadvisor?.webView).toBeNull();
    expect(mockFetchAndParseRating).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tripadvisor' }),
      TA_LISTING,
      QUERY,
      { confirmIdentity: true },
    );
  });

  it('falls back to the WebView listing stage when the search listing fetch is blocked', async () => {
    mockResolveKnownListing.mockResolvedValue(null);
    mockFetchAndParseRating.mockResolvedValue(null);

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    act(() => {
      result.current.handleMessage('tripadvisor', SEARCH_PAYLOAD);
    });
    await act(async () => {
      await flush();
    });

    const tripadvisor = result.current.states.find((s) => s.provider === 'tripadvisor');
    expect(tripadvisor?.webView?.stage).toBe('listing');
    expect(tripadvisor?.webView?.uri).toBe(TA_LISTING);
  });

  it('bounds a stalled fetch phase so a fetch-only pipeline still settles', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING : null),
    );
    // A fetch that never settles — the phase bound must break the deadlock.
    mockFetchAndParseRating.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.webView).toBeNull();

    act(() => {
      jest.advanceTimersByTime(FETCH_PHASE_TIMEOUT_MS + 1_000);
    });
    await act(async () => {
      await flush();
    });

    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.webView?.stage).toBe(
      'listing',
    );
  });

  it('keeps a timed-out provider retryable instead of memoizing a miss', async () => {
    mockResolveKnownListing.mockResolvedValue(null);

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    act(() => {
      jest.advanceTimersByTime(STAGE_TIMEOUT_MS + 1_000);
    });

    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.status).toBe('failed');
    expect(isExternalRatingMiss(missKey('tripadvisor'))).toBe(false);
  });

  it('memoizes a real verdict so reopening the card does not repeat it', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING : null),
    );
    // Force the WebView listing stage: the plain fetch yields nothing.
    mockFetchAndParseRating.mockResolvedValue(null);

    const { result } = renderHook(() => useExternalRatings(QUERY, 'place-1'));

    await act(async () => {
      await flush();
    });

    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.webView?.uri).toBe(
      TA_LISTING,
    );

    act(() => {
      result.current.handleMessage('tripadvisor', CHALLENGE_PAYLOAD);
    });

    expect(result.current.states.find((s) => s.provider === 'tripadvisor')?.status).toBe('failed');
    expect(isExternalRatingMiss(missKey('tripadvisor'))).toBe(true);
  });
});
