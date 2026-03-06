import NativePolarisValhalla, {
  type ValhallaConfig,
  type Waypoint,
  type RouteOptions,
  type ReroutePosition,
  type NativeValhallaRoute,
} from './NativePolarisValhalla';
import type {
  ValhallaRoute,
  ValhallaLeg,
  ValhallaManeuver,
  CostingModel,
  ManeuverType,
} from '../../models/route';

export type { ValhallaConfig };

function mapNativeRoute(native: NativeValhallaRoute): ValhallaRoute {
  return {
    summary: {
      distanceMeters: native.summary.distance_meters,
      durationSeconds: native.summary.duration_seconds,
      hasToll: native.summary.has_toll,
      hasFerry: native.summary.has_ferry,
    },
    legs: native.legs.map(
      (leg): ValhallaLeg => ({
        distanceMeters: leg.distance_meters,
        durationSeconds: leg.duration_seconds,
        maneuvers: leg.maneuvers.map(
          (m): ValhallaManeuver => ({
            type: m.type as ManeuverType,
            instruction: m.instruction,
            distanceMeters: m.distance_meters,
            durationSeconds: m.duration_seconds,
            beginShapeIndex: m.begin_shape_index,
            endShapeIndex: m.end_shape_index,
            streetNames: m.street_names,
            verbalPreTransition: m.verbal_pre_transition,
            verbalPostTransition: m.verbal_post_transition,
          }),
        ),
      }),
    ),
    geometry: native.geometry,
    boundingBox: native.bounding_box,
  };
}

export async function initialize(config: ValhallaConfig): Promise<void> {
  return NativePolarisValhalla.initialize(config);
}

export async function computeRoute(
  waypoints: Waypoint[],
  costing: CostingModel,
  options?: RouteOptions,
): Promise<ValhallaRoute[]> {
  const results = await NativePolarisValhalla.computeRoute(waypoints, costing, options);
  return results.map(mapNativeRoute);
}

export async function reroute(
  currentPosition: ReroutePosition,
  destination: Waypoint,
  costing: CostingModel,
): Promise<ValhallaRoute> {
  const result = await NativePolarisValhalla.reroute(currentPosition, destination, costing);
  return mapNativeRoute(result);
}

export async function updateTrafficSpeeds(speeds: Record<string, number>): Promise<void> {
  return NativePolarisValhalla.updateTrafficSpeeds(speeds);
}

export function hasCoverage(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): boolean {
  return NativePolarisValhalla.hasCoverage(bounds);
}

export async function getLoadedRegions(): Promise<
  Array<{ regionId: string; tilePath: string; sizeBytes: number }>
> {
  return NativePolarisValhalla.getLoadedRegions();
}

export async function dispose(): Promise<void> {
  return NativePolarisValhalla.dispose();
}
