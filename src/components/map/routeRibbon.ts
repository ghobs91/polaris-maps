/**
 * Route ribbon geometry.
 *
 * The ribbon is drawn as a stack — casing, glow, line, core — so each band
 * peeks out from under the one above it. Kept free of React Native imports so
 * the widths can be checked against the road widths the navigation-focus style
 * paints in a unit test: the route must cover the carriageway it is drawn on,
 * and that invariant spans two modules that would otherwise drift apart.
 */

import { haversineMeters } from '../../utils/routeSnap';

export interface RibbonBand {
  id: string;
  color: unknown;
  width: unknown;
  opacity: number;
}

/**
 * A zoom-interpolated width from stops at zoom 10 / 14 / 17.
 *
 * `scale` multiplies the *outputs* only, never the zoom stops. Do not reach for
 * `['*', expression, scale]` here: MapLibre Native raises on an expression shape
 * it cannot type-check for the property, which aborts the app rather than
 * drawing something wrong (see `navFocusStyle`). Scaling the numbers keeps the
 * expression shaped exactly like the one the style already ships.
 */
export function zoomWidth(stops: readonly [number, number, number], scale = 1): unknown {
  // Rounded so raw float multiplication does not emit 7.6499999999999995.
  const at = (stop: number) => Math.round(stop * scale * 1000) / 1000;
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    at(stops[0]),
    14,
    at(stops[1]),
    17,
    at(stops[2]),
  ];
}

/** Light mode keeps the original white casing and two-band ribbon. */
const STOPS_CASING_LIGHT = [4, 7, 11] as const;
/** Dark mode is wider so the glow has room to show outside the line. */
const STOPS_CASING_DARK = [5, 8.5, 13] as const;
const STOPS_GLOW = [4.5, 7.5, 11] as const;
const STOPS_LINE = [2, 4.5, 7.5] as const;
const STOPS_CORE = [0.9, 2, 3.2] as const;

/** Rim under the ribbon on the dark basemap — a white halo would out-shine it. */
export const DARK_CASING_COLOR = '#0A2E3A';
/** Bleed of the route colour outside the line: DEFAULT_ROUTE_COLOR at 30%. */
export const DARK_GLOW_COLOR = 'rgba(11,110,214,0.3)';
/**
 * Specular highlight along the ribbon's centre. Neutral white rather than a
 * lighter tint so congested amber/red segments read as lit too, instead of
 * turning pink.
 */
export const DARK_CORE_COLOR = 'rgba(255,255,255,0.3)';

/**
 * Navigation multipliers, applied per band.
 *
 * The line grows most: at zoom 17 it goes from 7.5 to 12.8 points, which covers
 * a primary road's lifted 12.2-point fill. That relationship is asserted
 * directly in `routeRibbon.test.ts` against the navigation-focus style. The
 * casing grows less so the ribbon does not turn into a mostly-dark outline with
 * a thin stripe of colour inside it. Ordering — casing widest, then glow, line,
 * core — holds at every zoom because the base stops are ordered and every
 * multiplier keeps that order.
 */
export const NAV_RIBBON_SCALE = {
  casing: 1.4,
  glow: 1.45,
  line: 1.7,
  core: 1.6,
} as const;

const UNSCALED = { casing: 1, glow: 1, line: 1, core: 1 } as const;

/**
 * Opacity of the stretch already driven. Low enough that the live-ahead route
 * stays the only high-chroma object on screen, high enough that the driven
 * ribbon still reads as "the way you came" rather than disappearing.
 */
export const COMPLETED_ROUTE_OPACITY = 0.35;

export interface SplitRoute {
  /** Route from the start to the vehicle, ending at the seam point. */
  completed: [number, number][];
  /** Route from the seam point to the destination. */
  remaining: [number, number][];
  /** Length of the completed half, in meters. */
  completedMeters: number;
}

/**
 * Split a decoded route at the vehicle, `remainingMeters` from its end.
 *
 * Returns `null` when there is nothing worth splitting: no live distance yet,
 * nothing driven, or the whole route still ahead. Callers then keep a single
 * ribbon, so no seam is drawn at the very start of a trip.
 */
export function splitRouteAtRemaining(
  coords: [number, number][],
  remainingMeters: number | null | undefined,
): SplitRoute | null {
  if (coords.length < 2) return null;
  if (remainingMeters == null || !Number.isFinite(remainingMeters)) return null;
  if (remainingMeters <= 0) return null;

  let totalMeters = 0;
  for (let i = 1; i < coords.length; i++) totalMeters += haversineMeters(coords[i - 1], coords[i]);
  if (remainingMeters >= totalMeters) return null;

  const completedMeters = totalMeters - remainingMeters;

  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const segmentMeters = haversineMeters(coords[i - 1], coords[i]);
    if (acc + segmentMeters >= completedMeters) {
      const t = segmentMeters > 0 ? (completedMeters - acc) / segmentMeters : 0;
      const seam: [number, number] = [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
      const completed = [...coords.slice(0, i), seam];
      const remaining = [seam, ...coords.slice(i)];
      // A seam landing exactly on a vertex must not leave a duplicated point
      // (a zero-length segment) at the end of either half.
      if (t <= 0) completed.pop();
      if (t >= 1) remaining.shift();
      if (completed.length < 2 || remaining.length < 2) return null;
      return { completed, remaining, completedMeters };
    }
    acc += segmentMeters;
  }

  return null;
}

/**
 * Build the ribbon band stack for one route source. `lineColor` is what the
 * line band paints with — the plain route colour for the fallback source, or
 * the per-feature traffic colour for the traffic source.
 *
 * `opacityScale` fades the whole stack, which is how the already-driven part of
 * the route recedes behind the vehicle.
 */
export function buildRibbon(
  prefix: string,
  lineColor: unknown,
  isDark: boolean,
  visible: boolean,
  navigation: boolean,
  opacityScale = 1,
): RibbonBand[] {
  const opacity = visible ? opacityScale : 0;
  const scale = navigation ? NAV_RIBBON_SCALE : UNSCALED;
  const bands: RibbonBand[] = [
    {
      id: `${prefix}-casing`,
      color: isDark ? DARK_CASING_COLOR : '#FFFFFF',
      width: zoomWidth(isDark ? STOPS_CASING_DARK : STOPS_CASING_LIGHT, scale.casing),
      opacity,
    },
  ];

  if (isDark) {
    bands.push({
      id: `${prefix}-glow`,
      color: DARK_GLOW_COLOR,
      width: zoomWidth(STOPS_GLOW, scale.glow),
      opacity,
    });
  }

  bands.push({
    id: `${prefix}-line`,
    color: lineColor,
    width: zoomWidth(STOPS_LINE, scale.line),
    opacity,
  });

  if (isDark) {
    bands.push({
      id: `${prefix}-core`,
      color: DARK_CORE_COLOR,
      width: zoomWidth(STOPS_CORE, scale.core),
      opacity,
    });
  }

  return bands;
}
