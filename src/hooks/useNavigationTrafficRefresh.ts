import { useEffect } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import {
  startPeriodicRefresh,
  stopPeriodicRefresh,
  fetchTrafficImmediate,
} from '../services/traffic/trafficFlowService';

/**
 * When navigation is active, fetches traffic immediately for the route
 * bounding box, then starts periodic refresh. Stops on navigation end.
 */
export function useNavigationTrafficRefresh(): void {
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const activeRoute = useNavigationStore((s) => s.activeRoute);

  useEffect(() => {
    if (!isNavigating || !activeRoute) {
      stopPeriodicRefresh();
      return;
    }

    // Fetch immediately so traffic ETA is available right away
    const bbox = activeRoute.boundingBox;
    fetchTrafficImmediate({
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
      zoom: 14,
    });

    // Then keep refreshing periodically
    startPeriodicRefresh(activeRoute.boundingBox, 14);

    return () => {
      stopPeriodicRefresh();
    };
  }, [isNavigating, activeRoute]);
}
