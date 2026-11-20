/**
 * Route-preview ETA seeding.
 *
 * The directions preview header reads
 * `routePreviewTrafficEta ?? routePreview.summary.durationSeconds`, while the
 * driving HUD reads `trafficEtaSeconds` — a different number produced by a
 * different code path (`useTrafficEta`). Whenever the TomTom route-ETA request
 * was skipped (saved weekday flow already covers the route, or no key), nothing
 * set `routePreviewTrafficEta`, so the preview showed the router's traffic-free
 * duration and navigation immediately swapped in the local segment model. The
 * same road could read 14 min before the tap and 11 min after it.
 *
 * The preview now seeds its ETA from the traffic the device already holds,
 * through the same `computeRouteTrafficEta` the in-navigation refresh uses, so
 * the number the driver accepts is the number they are then shown.
 */

import type { NormalizedTrafficSegment } from '../../models/traffic';
import type { ValhallaRoute } from '../../models/route';
import { useNavigationStore } from '../../stores/navigationStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { computeRouteTrafficEta, trafficMatchRatio } from '../../utils/etaCalculator';

export interface PreviewTrafficEta {
  seconds: number;
  /** Fraction of the route that matched live traffic (0 = free-flow only). */
  matchRatio: number;
}

/** Pure: the preview ETA for one route given a traffic set. */
export function localPreviewTrafficEta(
  route: ValhallaRoute,
  traffic: NormalizedTrafficSegment[],
): PreviewTrafficEta {
  const result = computeRouteTrafficEta(route, traffic);
  return { seconds: result.totalSeconds, matchRatio: trafficMatchRatio(result) };
}

/**
 * Seed the preview's traffic ETA (and its match ratio) from on-device traffic.
 *
 * Must be called *after* `setRoutePreview`, which resets both fields, and only
 * for a driving route — walking/cycling/transit previews show the mode's own
 * duration.
 */
export function seedRoutePreviewTrafficEta(route: ValhallaRoute): PreviewTrafficEta {
  const eta = localPreviewTrafficEta(route, useTrafficStore.getState().normalizedSegments);
  useNavigationStore.getState().setRoutePreviewTrafficEta(eta.seconds, eta.matchRatio);
  return eta;
}
