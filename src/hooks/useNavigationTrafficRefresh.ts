import { useEffect } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import {
  stopPeriodicRefresh,
  fetchRouteTrafficImmediate,
  startRoutePeriodicRefresh,
} from '../services/traffic/trafficFlowService';
import { decodePolyline } from '../utils/polyline';

/**
 * When navigation is active or a route preview is shown, fetches traffic
 * along the route polyline, then starts periodic refresh during navigation.
 * Stops on navigation end / preview dismissal.
 */
export function useNavigationTrafficRefresh(): void {
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const activeRoute = useNavigationStore((s) => s.activeRoute);
  const routePreview = useNavigationStore((s) => s.routePreview);

  // The displayed route: active navigation takes priority over preview
  const route = activeRoute ?? routePreview;

  useEffect(() => {
    if (!route) {
      stopPeriodicRefresh();
      return;
    }

    const routeCoords = decodePolyline(route.geometry);
    if (routeCoords.length < 2) return;

    // Fetch immediately along the route so traffic colors appear right away
    fetchRouteTrafficImmediate(routeCoords);

    // Only periodically refresh during active navigation (not preview)
    if (isNavigating) {
      startRoutePeriodicRefresh(routeCoords);
    }

    return () => {
      stopPeriodicRefresh();
    };
  }, [isNavigating, route]);
}
