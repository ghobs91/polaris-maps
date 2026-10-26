jest.mock('../../src/constants/config', () => ({
  MAPILLARY_TOKEN: 'token',
}));

jest.mock('../../src/services/speedLimits/countryForPosition', () => ({
  countryCodeForPosition: jest.fn(),
}));

jest.mock('../../src/services/speedLimits/mapillarySpeedSigns', () => {
  const actual = jest.requireActual('../../src/services/speedLimits/mapillarySpeedSigns');
  return { ...actual, fetchSpeedLimitSigns: jest.fn() };
});

import { renderHook, waitFor } from '@testing-library/react-native';
import { useSpeedLimitSignFallback } from '../../src/hooks/useSpeedLimitSignFallback';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import { countryCodeForPosition } from '../../src/services/speedLimits/countryForPosition';
import { fetchSpeedLimitSigns } from '../../src/services/speedLimits/mapillarySpeedSigns';

const mockCountry = countryCodeForPosition as jest.Mock;
const mockFetchSigns = fetchSpeedLimitSigns as jest.Mock;

/** A detection at the car's position, in the sign's own unit. */
function signAt(lng: number, lat: number, limitMph: number) {
  return [{ id: `s-${limitMph}`, lng, lat, limitMph }];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCountry.mockResolvedValue('DE');
  mockFetchSigns.mockResolvedValue([]);
  useNavigationTrackingStore.setState({ navPosition: [13.405, 52.52] });
});

afterEach(() => {
  useNavigationTrackingStore.setState({ navPosition: null });
});

describe('useSpeedLimitSignFallback', () => {
  it('publishes a nearby detected limit', async () => {
    mockFetchSigns.mockResolvedValue(signAt(13.405, 52.52, 31.07));

    const { result } = renderHook(() => useSpeedLimitSignFallback(true));

    await waitFor(() => expect(result.current).toBeCloseTo(31.07, 2));
  });

  it('stays silent when no region can supply a unit', async () => {
    // No country means the unit of a "50" sign is unknowable. Showing 50 mph in
    // a 50 km/h zone is worse than showing nothing.
    mockCountry.mockResolvedValue(null);

    const { result } = renderHook(() => useSpeedLimitSignFallback(true));

    await waitFor(() => expect(mockCountry).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(mockFetchSigns).not.toHaveBeenCalled();
  });

  it('does nothing while navigation is off', async () => {
    const { result } = renderHook(() => useSpeedLimitSignFallback(false));

    await waitFor(() => expect(result.current).toBeNull());
    expect(mockCountry).not.toHaveBeenCalled();
    expect(mockFetchSigns).not.toHaveBeenCalled();
  });

  it('stays silent when the fetch yields no sign near the car', async () => {
    // Detection ~200 m away belongs to a parallel street, not this one.
    mockFetchSigns.mockResolvedValue(signAt(13.4075, 52.52, 31.07));

    const { result } = renderHook(() => useSpeedLimitSignFallback(true));

    await waitFor(() => expect(mockFetchSigns).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('resolves the country once per trip', async () => {
    mockFetchSigns.mockResolvedValue(signAt(13.405, 52.52, 31.07));

    const { rerender } = renderHook(({ enabled }) => useSpeedLimitSignFallback(enabled), {
      initialProps: { enabled: true },
    });

    await waitFor(() => expect(mockCountry).toHaveBeenCalledTimes(1));
    rerender({ enabled: true });
    expect(mockCountry).toHaveBeenCalledTimes(1);
  });
});
