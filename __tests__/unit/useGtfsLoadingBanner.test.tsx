import { act, renderHook } from '@testing-library/react-native';

import {
  GTFS_LOADING_BANNER_TIMEOUT_MS,
  useGtfsLoadingBanner,
} from '../../src/hooks/useGtfsLoadingBanner';
import { useTransitStore } from '../../src/stores/transitStore';

beforeEach(() => {
  jest.useFakeTimers();
  useTransitStore.setState({ gtfsLoadingAgency: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useGtfsLoadingBanner', () => {
  it('returns the loading agency and clears it after the timeout', () => {
    const { result } = renderHook(() => useGtfsLoadingBanner());

    act(() => {
      useTransitStore.getState().setGtfsLoadingAgency('RTD Denver');
    });
    expect(result.current).toBe('RTD Denver');

    act(() => {
      jest.advanceTimersByTime(GTFS_LOADING_BANNER_TIMEOUT_MS);
    });

    expect(result.current).toBeNull();
    expect(useTransitStore.getState().gtfsLoadingAgency).toBeNull();
  });

  it('cancels the pending dismissal when a new agency starts loading', () => {
    const { result } = renderHook(() => useGtfsLoadingBanner());

    act(() => {
      useTransitStore.getState().setGtfsLoadingAgency('Agency A');
    });
    act(() => {
      jest.advanceTimersByTime(GTFS_LOADING_BANNER_TIMEOUT_MS - 1_000);
      useTransitStore.getState().setGtfsLoadingAgency('Agency B');
    });
    act(() => {
      jest.advanceTimersByTime(2_000);
    });

    // The first timer was replaced, so Agency B is still showing.
    expect(result.current).toBe('Agency B');
  });
});
