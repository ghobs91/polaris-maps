import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface ValhallaConfig {
  graphTilePath: string;
  trafficSpeedMap?: string;
}

export interface Waypoint {
  lat: number;
  lng: number;
}

export interface RouteOptions {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  alternates?: number;
}

export interface ReroutePosition {
  lat: number;
  lng: number;
  bearing: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface LoadedRegionInfo {
  regionId: string;
  tilePath: string;
  sizeBytes: number;
}

// The raw route shape returned by native (JSON-compatible)
export interface NativeValhallaRoute {
  summary: {
    distance_meters: number;
    duration_seconds: number;
    has_toll: boolean;
    has_ferry: boolean;
  };
  legs: Array<{
    maneuvers: Array<{
      type: string;
      instruction: string;
      distance_meters: number;
      duration_seconds: number;
      begin_shape_index: number;
      end_shape_index: number;
      street_names?: string[];
      verbal_pre_transition: string;
      verbal_post_transition?: string;
    }>;
    distance_meters: number;
    duration_seconds: number;
  }>;
  geometry: string;
  bounding_box: [number, number, number, number];
}

export interface Spec extends TurboModule {
  initialize(config: ValhallaConfig): Promise<void>;
  computeRoute(
    waypoints: Waypoint[],
    costing: string,
    options?: RouteOptions,
  ): Promise<NativeValhallaRoute[]>;
  reroute(
    currentPosition: ReroutePosition,
    destination: Waypoint,
    costing: string,
  ): Promise<NativeValhallaRoute>;
  updateTrafficSpeeds(speeds: Record<string, number>): Promise<void>;
  hasCoverage(bounds: Bounds): boolean;
  getLoadedRegions(): Promise<LoadedRegionInfo[]>;
  dispose(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('PolarisValhalla');
