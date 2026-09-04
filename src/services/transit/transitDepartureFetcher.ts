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
  findOtpStopIds,
  fetchOtp1Stoptimes,
  fetchOtpRoutesAtStop,
  type Otp1StopTime,
  type Otp1TripStopTime,
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
  /** OTP trip ID (enables the trip-detail stop list); absent for estimates */
  tripId?: string;
  /** Trip headsign / terminal (e.g. "86 St") when OTP provides one */
  tripHeadsign?: string;
  /** Service-day midnight (epoch seconds) for resolving per-stop times */
  serviceDay?: number;
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

/**
 * Far-future departures read better as a clock time ("7:07 AM") than as a
 * large minute count, so the row shows the leaving time when more than 60
 * minutes away and a countdown otherwise.
 */
export function shouldShowClockTime(minutesAway: number): boolean {
  return minutesAway > 60;
}

// ── Trip detail (stops served by one departure) ─────────────────────

export interface TripStop {
  name: string;
  lat?: number;
  lon?: number;
  /** Scheduled arrival ISO timestamp (absent when unresolvable) */
  scheduledTime?: string;
  /** Real-time arrival ISO timestamp (if predicted) */
  realtimeTime?: string;
  isRealtime: boolean;
  minutesAway?: number;
}

export interface TripStopList {
  stops: TripStop[];
  /** Index of the first stop at/after the boarded station */
  currentIndex: number;
}

/**
 * Assemble an ordered trip stop list from OTP1 trip stoptimes.
 * Per-stop times are seconds-since-midnight on `serviceDay`; without a
 * service day only names/coordinates are returned. The boarded station is
 * located by name first, then nearest coordinates.
 */
export function buildTripStopList(
  times: Otp1TripStopTime[],
  serviceDay: number | undefined,
  currentStop: { name: string; lat: number; lon: number },
  nowMs = Date.now(),
): TripStopList {
  const ordered = [...times].sort((a, b) => a.stopIndex - b.stopIndex);
  const q = currentStop.name.toLowerCase().trim();

  let currentIndex = ordered.findIndex((t) => (t.stopName ?? '').toLowerCase().trim() === q);
  if (currentIndex < 0 && q) {
    currentIndex = ordered.findIndex((t) => {
      const n = (t.stopName ?? '').toLowerCase().trim();
      return n && (n.includes(q) || q.includes(n));
    });
  }
  if (currentIndex < 0) {
    let best = Infinity;
    ordered.forEach((t, i) => {
      if (t.stopLat == null || t.stopLon == null) return;
      const d = (t.stopLat - currentStop.lat) ** 2 + (t.stopLon - currentStop.lon) ** 2;
      if (d < best) {
        best = d;
        currentIndex = i;
      }
    });
  }
  if (currentIndex < 0) currentIndex = 0;

  const stops: TripStop[] = ordered.map((t) => {
    const scheduledTime =
      serviceDay != null
        ? new Date((serviceDay + t.scheduledArrival) * 1000).toISOString()
        : undefined;
    const realtimeTime =
      serviceDay != null && t.realtime
        ? new Date((serviceDay + t.realtimeArrival) * 1000).toISOString()
        : undefined;
    const arrivalMs =
      realtimeTime != null
        ? Date.parse(realtimeTime)
        : scheduledTime != null
          ? Date.parse(scheduledTime)
          : NaN;
    return {
      name: t.stopName ?? t.stopId,
      lat: t.stopLat,
      lon: t.stopLon,
      scheduledTime,
      realtimeTime,
      isRealtime: t.realtime,
      minutesAway: Number.isNaN(arrivalMs) ? undefined : Math.round((arrivalMs - nowMs) / 60_000),
    };
  });

  return { stops, currentIndex };
}

/** Status sub-label for one trip stop ("Live · in 14 min", "Live", "Scheduled"). */
export function formatTripStopStatus(stop: Pick<TripStop, 'isRealtime' | 'minutesAway'>): string {
  if (!stop.isRealtime) return 'Scheduled';
  if (stop.minutesAway == null || stop.minutesAway < 0) return 'Live';
  if (stop.minutesAway <= 1) return 'Live · now';
  return `Live · in ${stop.minutesAway} min`;
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

/** Map an OTP1 route mode string onto our TransitMode (default: RAIL). */
function otpRouteMode(mode: string | undefined, fallback: TransitMode): TransitMode {
  switch (mode) {
    case 'SUBWAY':
      return 'SUBWAY';
    case 'RAIL':
      return 'RAIL';
    case 'TRAM':
    case 'LIGHT_RAIL':
      return 'TRAM';
    case 'FERRY':
      return 'FERRY';
    case 'BUS':
      return 'BUS';
    default:
      return fallback;
  }
}

/** Normalise a route colour to 6-hex without `#` (undefined when absent/invalid). */
function normalizeRouteColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const hex = color.startsWith('#') ? color.slice(1) : color;
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? hex : undefined;
}

/**
 * Familiar names for OTP agency/feed IDs. The trip ID's first segment is the
 * agency (e.g. "LI"), never a line — LIRR routes carry no shortName, so the
 * raw code would otherwise reach the UI. Show the public name instead.
 */
export const OTP_AGENCY_DISPLAY_NAMES: Record<string, string> = {
  LI: 'LIRR',
  MNR: 'Metro-North',
  MTASBWY: 'Subway',
  PATH: 'PATH',
  NJT: 'NJ Transit',
};

function otp1StoptimesToDepartures(
  stoptimes: Otp1StopTime[],
  routesByStopId: Map<string, { color?: string; mode: TransitMode }>,
): Departure[] {
  const now = Date.now();
  const departures: Departure[] = [];

  for (const entry of stoptimes) {
    // The departure's line comes from the pattern's route object
    // (e.g. shortName "W" for MTASBWY:W). Never use the trip ID's first
    // segment — that is the agency/feed ID ("MTASBWY" = the whole network).
    // Pattern desc: "Port Jefferson Branch to Penn Station via Hicksville"
    const desc = entry.pattern.desc ?? '';

    let ref = entry.route?.shortName?.trim() || undefined;
    let color = normalizeRouteColor(entry.route?.color);
    let mode: TransitMode | undefined = entry.route?.mode
      ? otpRouteMode(entry.route.mode, 'RAIL')
      : undefined;

    if (!ref) {
      // Fall back to the route segment of the pattern id
      // (MTA "MTASBWY:W:1:02" → "W", LIRR-style "1:LI:test" → "LI"),
      // but only when it matches a route known to serve this stop.
      const seg = entry.pattern.id.split(':').find((s) => routesByStopId.has(s.trim()));
      if (seg) ref = seg.trim();
    }
    const known = (ref && routesByStopId.get(ref)) || undefined;
    color ??= known?.color;
    mode ??= known?.mode ?? 'RAIL';

    for (const t of entry.times) {
      const depEpochMs = (t.serviceDay + t.realtimeDeparture) * 1000;
      if (depEpochMs < now) continue; // skip past departures

      const minutesAway = Math.round((depEpochMs - now) / 60_000);
      if (minutesAway > 180) continue; // skip departures > 3h away

      // Last resort for endpoints without route objects or matching pattern
      // ids: the trip ID's first segment, mapped to a familiar agency name
      // when it is a known agency code (e.g. "LI" → "LIRR").
      const tripPrefix = t.tripId?.split(':')[0] || undefined;
      const tripPrefixDisplay = (tripPrefix && OTP_AGENCY_DISPLAY_NAMES[tripPrefix]) || tripPrefix;

      // Extract headsign: prefer stopHeadsign, fall back to pattern desc
      let headsign = t.stopHeadsign ?? '';
      if (!headsign && desc) {
        // Pattern desc like "Babylon Branch to Babylon (LI:118) from Penn
        // Station (LI:8) like trip LI_...". Extract only the destination, which
        // sits after " to " and before the "(ref)". The old regex captured the
        // whole remainder (origin, refs, trip id), leaking e.g. "Long Beach"
        // (an origin for Penn-bound trains) into the displayed headsign.
        const destMatch = desc.match(/ to (.+?)(?=\s*(?:\(|via|from\b|$))/i);
        headsign = destMatch ? destMatch[1].trim() : desc;
      }

      departures.push({
        routeName: ref || tripPrefixDisplay || '?',
        routeLongName: entry.route?.longName?.trim() || desc || undefined,
        headsign,
        color,
        mode: mode ?? 'RAIL',
        scheduledTime: new Date((t.serviceDay + t.scheduledDeparture) * 1000).toISOString(),
        realtimeTime: t.realtime ? new Date(depEpochMs).toISOString() : undefined,
        isRealtime: t.realtime,
        minutesAway,
        tripId: t.tripId || undefined,
        tripHeadsign: t.tripHeadsign || undefined,
        serviceDay: t.serviceDay,
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
    // A station can have several directional stop IDs sharing one name
    // (e.g. MTA City Hall = R24S southbound + R24N northbound). Query all of
    // them so departures cover both directions, then merge.
    const stopIds = await findOtpStopIds(stopName, _lat, _lon);
    if (stopIds.length > 0) {
      const perStop = await Promise.all(
        stopIds.map(async (stopId) => {
          const [stoptimes, otpRoutes] = await Promise.all([
            fetchOtp1Stoptimes(stopId, _lat, _lon),
            fetchOtpRoutesAtStop(stopId, _lat, _lon),
          ]);
          return { stoptimes, otpRoutes };
        }),
      );
      const stoptimes = perStop.flatMap((p) => p.stoptimes);
      // Union routes across directions, deduped by ref
      const seenRefs = new Set<string>();
      const otpRoutes = perStop
        .flatMap((p) => p.otpRoutes)
        .filter((r) => {
          const key = r.ref ?? r.name ?? '';
          if (seenRefs.has(key)) return false;
          seenRefs.add(key);
          return true;
        });

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
          // Build route badges from actual departures — one badge per line
          // (route short name), not per headsign/destination.
          const seenRoutes = new Set<string>();
          const depRoutes: StopDepartureInfo['routes'] = [];
          for (const d of departures) {
            if (seenRoutes.has(d.routeName)) continue;
            seenRoutes.add(d.routeName);
            depRoutes.push({ name: d.routeName, color: d.color, mode: d.mode });
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
