/**
 * Transitous MOTIS 2 departure adapter.
 *
 * Fetches real-time and scheduled departure data from the Transitous
 * MOTIS API and maps it to the existing `StopDepartureInfo` model.
 */

import { TRANSITOUS_BASE_URL } from '../../constants/config';
import type { StopDepartureInfo, Departure } from './transitDepartureFetcher';
import type { TransitMode } from '../../models/transit';

const FETCH_TIMEOUT_MS = 15_000;

interface MotisStopEvent {
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLon: number;
  departure: {
    scheduledTime: string;
    estimatedTime?: string;
    delaySeconds?: number;
  };
  trip: {
    tripId: string;
    line: {
      name?: string;
      shortName?: string;
      color?: string;
      type?: string;
    };
    headsign?: string;
    direction?: string;
  };
}

interface MotisStopEventResponse {
  stop: {
    name: string;
    id: string;
    lat: number;
    lon: number;
  };
  events: MotisStopEvent[];
}

function getBaseUrl(): string {
  return (TRANSITOUS_BASE_URL || 'https://api.transitous.org/api').replace(/\/api\/?$/, '');
}

function transitousRouteTypeToMode(type?: string): TransitMode {
  const map: Record<string, TransitMode> = {
    subway: 'SUBWAY',
    metro: 'SUBWAY',
    tram: 'TRAM',
    light_rail: 'TRAM',
    train: 'RAIL',
    rail: 'RAIL',
    bus: 'RAIL',
    ferry: 'FERRY',
  };
  return map[(type ?? '').toLowerCase()] ?? 'RAIL';
}

/**
 * Fetch departures from Transitous for a given stop.
 * Returns null if the stop is not found or the API is unavailable.
 */
export async function fetchTransitousDepartures(
  stopName: string,
  lat: number,
  lon: number,
): Promise<StopDepartureInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // MOTIS v1 stoptimes/stopevent endpoint
    const url = `${getBaseUrl()}/api/v1/stoptimes?stopId=&lat=${lat}&lon=${lon}&count=20`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PolarisMaps/1.0 (mailto:maps@polaris.app)',
        Accept: 'application/json',
      },
    });

    if (!res.ok) return null;

    const data = await res.json();

    // Adapt to StopDepartureInfo format
    const events: MotisStopEventResponse = data;
    const departures: Departure[] = (events.events ?? []).map((ev) => {
      const schedMs = new Date(ev.departure.scheduledTime).getTime();
      const estMs = ev.departure.estimatedTime
        ? new Date(ev.departure.estimatedTime).getTime()
        : schedMs;
      const delaySeconds = ev.departure.delaySeconds ?? Math.round((estMs - schedMs) / 1000);
      const isRealtime = !!ev.departure.estimatedTime;
      const effectiveMs = isRealtime ? estMs : schedMs;

      return {
        routeName: ev.trip.line.shortName ?? ev.trip.line.name ?? '',
        routeLongName: ev.trip.line.name,
        headsign: ev.trip.headsign ?? '',
        color: ev.trip.line.color,
        mode: transitousRouteTypeToMode(ev.trip.line.type),
        scheduledTime: ev.departure.scheduledTime,
        realtimeTime: ev.departure.estimatedTime,
        isRealtime,
        minutesAway: Math.max(0, Math.round((effectiveMs - Date.now()) / 60_000)),
      };
    });

    // Collect unique routes for badges
    const routeSet = new Map<string, { name: string; color?: string; mode: TransitMode }>();
    for (const d of departures) {
      const key = d.routeName;
      if (!routeSet.has(key)) {
        routeSet.set(key, {
          name: d.routeName,
          color: d.color,
          mode: d.mode,
        });
      }
    }

    return {
      stopName: events.stop?.name ?? stopName,
      routes: [...routeSet.values()],
      alerts: [],
      departures: departures.slice(0, 20),
    };
  } catch (e) {
    console.warn('[transitous] fetchTransitousDepartures failed:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
