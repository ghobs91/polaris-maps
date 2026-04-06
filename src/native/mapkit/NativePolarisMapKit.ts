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
}

export default TurboModuleRegistry.get<Spec>('PolarisMapKit');
