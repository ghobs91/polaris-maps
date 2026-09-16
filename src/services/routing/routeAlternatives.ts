import type { ValhallaRoute } from '../../models/route';

export interface RouteAlternative {
  route: ValhallaRoute;
  durationSeconds: number;
  distanceMeters: number;
  /** Seconds slower than the fastest option (0 for the fastest). */
  delaySeconds: number;
}

/**
 * Normalize a primary route plus its alternates into display-ready options,
 * sorted fastest first with the delay relative to the fastest route. Returns
 * an empty array when there is no route (callers must never render an empty
 * list as if it were a choice).
 */
export function buildRouteAlternatives(
  primary: ValhallaRoute | null | undefined,
  alternates: readonly ValhallaRoute[],
): RouteAlternative[] {
  const all = primary ? [primary, ...alternates] : [...alternates];
  if (all.length === 0) return [];

  const fastest = Math.min(...all.map((route) => route.summary.durationSeconds));

  return all
    .map((route) => ({
      route,
      durationSeconds: route.summary.durationSeconds,
      distanceMeters: route.summary.distanceMeters,
      delaySeconds: Math.max(0, route.summary.durationSeconds - fastest),
    }))
    .sort((a, b) => a.durationSeconds - b.durationSeconds);
}
