import { getNearbyStops } from '../transit/transitRoutingService';
import { computeRoute } from '../routing/routingService';
import { planTransitTrip } from '../transit/transitRoutingService';
import type { ValhallaRoute } from '../../models/route';
import type { OtpItinerary } from '../../models/transit';

/** Walking speed in m/s (~5 km/h). */
const WALK_SPEED_MS = 1.39;
/** 20 minutes in seconds. */
const WALK_THRESHOLD_SECONDS = 20 * 60;

export interface ParkAndRideResult {
  /** Driving leg: user location → nearest train station */
  drivingLeg: ValhallaRoute;
  /** Transit leg: origin station → destination station */
  transitLeg: OtpItinerary;
  /** Name of the station driven to */
  stationName: string;
  /** Total estimated duration (driving + transit) in seconds */
  totalDurationSeconds: number;
}

/**
 * Check whether the user is farther than a 20-minute walk from the nearest
 * train/rail station. Returns the station info if park-and-ride should be offered.
 */
export async function shouldOfferParkAndRide(
  userLat: number,
  userLng: number,
): Promise<{ offered: boolean; stationName?: string; stationLat?: number; stationLng?: number }> {
  try {
    // Search for rail stops within 5 km
    const nearbyStops = await getNearbyStops(userLat, userLng, 5000, 10);

    // Filter to rail/subway stations only
    const railStops = nearbyStops.filter((s) => {
      const routes = s.stop.routes ?? [];
      return routes.some((r) => r.mode === 'RAIL' || r.mode === 'SUBWAY');
    });

    if (railStops.length === 0) {
      return { offered: false };
    }

    const nearest = railStops[0];

    // Estimate walking time via straight-line distance
    const walkDistanceMeters = nearest.distanceMeters;
    const walkTimeSeconds = walkDistanceMeters / WALK_SPEED_MS;

    if (walkTimeSeconds <= WALK_THRESHOLD_SECONDS) {
      return { offered: false };
    }

    return {
      offered: true,
      stationName: nearest.stop.name,
      stationLat: nearest.stop.lat,
      stationLng: nearest.stop.lon,
    };
  } catch {
    return { offered: false };
  }
}

/**
 * Plan a park-and-ride trip: drive to nearest station, then take transit.
 */
export async function planParkAndRide(
  userLat: number,
  userLng: number,
  destLat: number,
  destLng: number,
): Promise<ParkAndRideResult> {
  // Find nearest rail station
  const check = await shouldOfferParkAndRide(userLat, userLng);
  if (!check.offered || !check.stationLat || !check.stationLng) {
    throw new Error('No suitable park-and-ride station found nearby');
  }

  // 1. Compute driving directions to the station
  const drivingRoutes = await computeRoute(
    [
      { lat: userLat, lng: userLng },
      { lat: check.stationLat, lng: check.stationLng },
    ],
    'auto',
  );
  if (!drivingRoutes.length) {
    throw new Error('Could not compute driving route to station');
  }

  // 2. Plan transit from station to destination
  const transitItineraries = await planTransitTrip({
    from: { lat: check.stationLat, lng: check.stationLng },
    to: { lat: destLat, lng: destLng },
  });
  if (!transitItineraries.length) {
    throw new Error('No transit routes found from station to destination');
  }

  const drivingLeg = drivingRoutes[0];
  const transitLeg = transitItineraries[0];

  return {
    drivingLeg,
    transitLeg,
    stationName: check.stationName!,
    totalDurationSeconds: drivingLeg.summary.durationSeconds + transitLeg.duration,
  };
}
