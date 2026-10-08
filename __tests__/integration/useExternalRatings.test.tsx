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

import { STAGE_TIMEOUT_MS, useExternalRatings } from '../../src/hooks/useExternalRatings';
import { browseScheduler } from '../../src/services/poi/externalRatings/antiBot';
import { clearSessionPlaceRatings } from '../../src/services/places/placeRatingSessionCache';
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
});
