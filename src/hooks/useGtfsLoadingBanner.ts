import { useEffect, useRef } from 'react';
import { useTransitStore } from '../stores/transitStore';

/** Loading banners auto-dismiss after this long so a stuck fetch can't linger. */
export const GTFS_LOADING_BANNER_TIMEOUT_MS = 15_000;

/**
 * Returns the agency currently loading GTFS lines (for the transit loading
 * banner) and clears it automatically after `GTFS_LOADING_BANNER_TIMEOUT_MS`.
 */
export function useGtfsLoadingBanner(): string | null {
  const gtfsLoadingAgency = useTransitStore((s) => s.gtfsLoadingAgency);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (gtfsLoadingAgency) {
      timer.current = setTimeout(() => {
        useTransitStore.getState().setGtfsLoadingAgency(null);
      }, GTFS_LOADING_BANNER_TIMEOUT_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [gtfsLoadingAgency]);

  return gtfsLoadingAgency;
}
