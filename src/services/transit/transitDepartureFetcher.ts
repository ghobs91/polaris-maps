/**
 * Fetches upcoming departures for a transit stop.
 *
 * Current strategy: estimated headway departures based on route mode.
 * GTFS-RT real-time predictions can be added later as a lightweight
 * streaming source (no heavy ZIP downloads).
 */

import type { TransitMode } from '../../models/transit';

// ── Types ───────────────────────────────────────────────────────────

export interface Departure {
  /** Route short name like "4", "A", "LIRR" */
  routeName: string;
  /** Full route name like "Lexington Avenue Express" */
  routeLongName?: string;
  /** Headsign / destination like "Woodlawn" */
  headsign: string;
  /** Route colour (6-hex, no #) */
  color?: string;
  /** Transit mode */
  mode: TransitMode;
  /** Scheduled departure ISO timestamp */
  scheduledTime: string;
  /** Real-time departure ISO timestamp (if available) */
  realtimeTime?: string;
  /** Whether this is from a real-time source */
  isRealtime: boolean;
  /** Minutes until departure */
  minutesAway: number;
}

export interface StopDepartureInfo {
  stopName: string;
  /** Route badges serving this stop */
  routes: Array<{
    name: string;
    color?: string;
    mode: TransitMode;
  }>;
  /** Service alerts for this stop */
  alerts: Array<{
    header: string;
    description?: string;
  }>;
  /** Upcoming departures sorted by time */
  departures: Departure[];
}

// ── Headway estimation ──────────────────────────────────────────────

function estimateHeadwayDepartures(routes: StopDepartureInfo['routes']): Departure[] {
  const now = new Date();
  const departures: Departure[] = [];

  for (const route of routes) {
    const headway = route.mode === 'SUBWAY' ? 5 : route.mode === 'TRAM' ? 10 : 20;
    for (let i = 0; i < 3; i++) {
      const offsetMin = headway * (i + 1);
      const depTime = new Date(now.getTime() + offsetMin * 60_000);
      departures.push({
        routeName: route.name,
        headsign: '',
        color: route.color,
        mode: route.mode,
        scheduledTime: depTime.toISOString(),
        isRealtime: false,
        minutesAway: offsetMin,
      });
    }
  }

  return departures.sort((a, b) => a.minutesAway - b.minutesAway);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch upcoming departures for a transit stop.
 *
 * Uses headway estimation based on route mode. GTFS-RT real-time
 * predictions can be layered on top later without heavy downloads.
 */
export async function fetchDepartures(
  stopName: string,
  _lat: number,
  _lon: number,
  routeNames: string[],
  routeColors: (string | undefined)[],
  modes: TransitMode[],
): Promise<StopDepartureInfo> {
  const routes = routeNames.map((name, i) => ({
    name,
    color: routeColors[i],
    mode: modes[i] ?? ('RAIL' as TransitMode),
  }));

  return {
    stopName,
    routes,
    alerts: [],
    departures: estimateHeadwayDepartures(routes),
  };
}
