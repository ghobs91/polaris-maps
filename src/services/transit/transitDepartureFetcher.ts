/**
 * Fetches upcoming departures for a transit stop.
 *
 * Current strategy: estimated headway departures based on route mode.
 * GTFS-RT real-time predictions can be added later as a lightweight
 * streaming source (no heavy ZIP downloads).
 */

import type { TransitMode } from '../../models/transit';
import { isInMbtaArea, fetchMbtaDepartures } from './mbtaFetcher';
import {
  findOtpStopId,
  fetchOtp1Stoptimes,
  fetchOtpRoutesAtStop,
  type Otp1StopTime,
} from './otpEndpointRegistry';

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

// ── OTP1 REST stoptimes → Departures ────────────────────────────────

function otp1StoptimesToDepartures(
  stoptimes: Otp1StopTime[],
  routesByStopId: Map<string, { color?: string; mode: TransitMode }>,
): Departure[] {
  const now = Date.now();
  const departures: Departure[] = [];

  for (const pattern of stoptimes) {
    // Extract route short name from pattern description or id
    // Pattern id format: "routeId:directionId:patternNum"
    // Pattern desc: "Port Jefferson Branch to Penn Station via Hicksville"
    const desc = pattern.pattern.desc ?? '';

    for (const t of pattern.times) {
      const depEpochMs = (t.serviceDay + t.realtimeDeparture) * 1000;
      if (depEpochMs < now) continue; // skip past departures

      const minutesAway = Math.round((depEpochMs - now) / 60_000);
      if (minutesAway > 180) continue; // skip departures > 3h away

      // Try to extract the route short name from the tripId (e.g. "LI:149::LI_FP_D3-Weekday-047")
      const tripParts = t.tripId?.split(':') ?? [];
      const agencyPrefix = tripParts[0] ?? '';

      // Try to find route info from the OTP routes data
      const routeInfo = routesByStopId.get(agencyPrefix);

      // Extract headsign: prefer stopHeadsign, fall back to pattern desc
      let headsign = t.stopHeadsign ?? '';
      if (!headsign && desc) {
        // Pattern desc like "Port Jefferson Branch to Penn Station via Hicksville"
        // Extract destination after "to "
        const toMatch = desc.match(/\bto\s+(.+?)(?:\s+via\b|$)/i);
        headsign = toMatch ? toMatch[1].trim() : desc;
      }

      departures.push({
        routeName: agencyPrefix || '?',
        routeLongName: desc,
        headsign,
        color: routeInfo?.color,
        mode: routeInfo?.mode ?? 'RAIL',
        scheduledTime: new Date((t.serviceDay + t.scheduledDeparture) * 1000).toISOString(),
        realtimeTime: t.realtime ? new Date(depEpochMs).toISOString() : undefined,
        isRealtime: t.realtime,
        minutesAway,
      });
    }
  }

  return departures.sort((a, b) => a.minutesAway - b.minutesAway).slice(0, 20);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch upcoming departures for a transit stop.
 *
 * In the MBTA service area, uses real schedule + prediction data from
 * the MBTA V3 API. Elsewhere, falls back to headway estimation.
 */
export async function fetchDepartures(
  stopName: string,
  _lat: number,
  _lon: number,
  routeNames: string[],
  routeColors: (string | undefined)[],
  modes: TransitMode[],
): Promise<StopDepartureInfo> {
  // Try MBTA real departures for Boston area stops
  if (isInMbtaArea(_lat, _lon)) {
    try {
      const mbtaInfo = await fetchMbtaDepartures(stopName, _lat, _lon);
      if (mbtaInfo && mbtaInfo.departures.length > 0) return mbtaInfo;
    } catch {
      // Fall through to OTP1 / headway estimation
    }
  }

  const routes = routeNames.map((name, i) => ({
    name,
    color: routeColors[i],
    mode: modes[i] ?? ('RAIL' as TransitMode),
  }));

  // Try OTP1 REST stoptimes (covers MTA/LIRR/Metro-North/NJT etc.)
  try {
    const stopId = await findOtpStopId(stopName, _lat, _lon);
    if (stopId) {
      const [stoptimes, otpRoutes] = await Promise.all([
        fetchOtp1Stoptimes(stopId, _lat, _lon),
        fetchOtpRoutesAtStop(stopId, _lat, _lon),
      ]);

      if (stoptimes.length > 0) {
        // Build a lookup for route metadata keyed by agency prefix
        const routeMap = new Map<string, { color?: string; mode: TransitMode }>();
        for (const r of otpRoutes) {
          if (r.ref) routeMap.set(r.ref, { color: r.color, mode: r.mode });
        }
        // Also map from the routes passed in
        for (const r of routes) {
          if (!routeMap.has(r.name)) routeMap.set(r.name, { color: r.color, mode: r.mode });
        }

        const departures = otp1StoptimesToDepartures(stoptimes, routeMap);
        if (departures.length > 0) {
          // Build route badges from actual departures
          const seenRoutes = new Set<string>();
          const depRoutes: StopDepartureInfo['routes'] = [];
          for (const d of departures) {
            const key = `${d.routeName}-${d.headsign}`;
            if (seenRoutes.has(key)) continue;
            seenRoutes.add(key);
            depRoutes.push({ name: d.headsign || d.routeName, color: d.color, mode: d.mode });
          }

          return {
            stopName,
            routes: depRoutes.length > 0 ? depRoutes : routes,
            alerts: [],
            departures,
          };
        }
      }
    }
  } catch {
    // Fall through to headway estimation
  }

  return {
    stopName,
    routes,
    alerts: [],
    departures: estimateHeadwayDepartures(routes),
  };
}
