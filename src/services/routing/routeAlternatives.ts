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
 *
 * `durationScale` (optional) multiplies every option's duration so the rows can
 * show the same live-traffic-adjusted time as the preview header instead of
 * free-flow values.
 */
export function buildRouteAlternatives(
  primary: ValhallaRoute | null | undefined,
  alternates: readonly ValhallaRoute[],
  durationScale: number | null = null,
): RouteAlternative[] {
  const all = primary ? [primary, ...alternates] : [...alternates];
  if (all.length === 0) return [];

  const scale = durationScale != null && durationScale > 0 ? durationScale : 1;
  const scaled = all.map((route) => ({
    route,
    durationSeconds: Math.round(route.summary.durationSeconds * scale),
    distanceMeters: route.summary.distanceMeters,
  }));

  const fastest = Math.min(...scaled.map((option) => option.durationSeconds));

  return scaled
    .map((option) => ({
      ...option,
      delaySeconds: Math.max(0, option.durationSeconds - fastest),
    }))
    .sort((a, b) => a.durationSeconds - b.durationSeconds);
}
