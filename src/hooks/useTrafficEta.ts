import { useEffect, useRef } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { fetchRouteTrafficEta } from '../services/traffic/tomtomRouteEta';

const ETA_REFRESH_INTERVAL_MS = 60_000;

/**
 * Periodically fetches traffic-adjusted ETA from TomTom's Calculate Route API
 * while navigation is active. Refreshes every 60 seconds.
 */
export function useTrafficEta(): void {
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const updateTrafficEta = useNavigationStore((s) => s.updateTrafficEta);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isNavigating || !activeRoute) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const fetchEta = async () => {
      const result = await fetchRouteTrafficEta(activeRoute.geometry);
      if (result) {
        updateTrafficEta(
          result.travelTimeSeconds,
          result.travelTimeSeconds - result.trafficDelaySeconds,
          1,
        );
      }
    };

    // Fetch immediately, then periodically
    fetchEta();
    intervalRef.current = setInterval(fetchEta, ETA_REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isNavigating, activeRoute, updateTrafficEta]);
}
