import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Raw result from the native PolarisMapKit.searchPOI call.
 * Mirrors the dictionary returned by the Swift serializeMapItem method.
 */
export interface NativeMapKitPoi {
  name?: string;
  phoneNumber?: string;
  url?: string;
  latitude: number;
  longitude: number;
  pointOfInterestCategory?: string;
  // Address components
  thoroughfare?: string;
  subThoroughfare?: string;
  locality?: string;
  subLocality?: string;
  administrativeArea?: string;
  subAdministrativeArea?: string;
  postalCode?: string;
  country?: string;
  isoCountryCode?: string;
  timeZone?: string;
  formattedAddress?: string;
  // Opening hours (iOS 16+)
  openingHoursPeriods?: Array<{
    openDay?: string;
    openTime?: string;
    closeDay?: string;
    closeTime?: string;
  }>;
}

/**
 * Raw route response from the native PolarisMapKit.computeRoute call.
 * Mirrors the dictionary returned by the Swift serializeRoute method.
 * Uses snake_case to match the Valhalla native module format.
 */
export interface NativeMapKitRoute {
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
      verbal_pre_transition: string;
    }>;
    distance_meters: number;
    duration_seconds: number;
  }>;
  geometry: string;
  bounding_box: [number, number, number, number];
}

export interface Spec extends TurboModule {
  searchPOI(query: string, latitude: number, longitude: number): Promise<NativeMapKitPoi | null>;
  searchPlace(query: string, regionHint: string | null): Promise<NativeMapKitPoi | null>;
  searchPlaceAll(query: string, regionHint: string | null): Promise<NativeMapKitPoi[]>;
  searchNearby(
    query: string,
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<NativeMapKitPoi[]>;
  computeRoute(
    waypoints: Array<{ lat: number; lng: number }>,
    costing: string,
  ): Promise<NativeMapKitRoute[]>;
  reroute(
    currentPosition: { lat: number; lng: number; bearing: number },
    destination: { lat: number; lng: number },
    costing: string,
  ): Promise<NativeMapKitRoute>;
}

export default TurboModuleRegistry.get<Spec>('PolarisMapKit');
