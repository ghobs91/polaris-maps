import { NativeModules, Platform } from 'react-native';
import type { NativeMapKitPoi } from './NativePolarisMapKit';

export type { NativeMapKitPoi };

const NativeModule = Platform.OS === 'ios' ? NativeModules.PolarisMapKit : null;
const isAvailable = NativeModule != null;

/**
 * Search for a POI using the native iOS MapKit SDK (MKLocalSearch).
 *
 * Returns rich data including phone number, URL, formatted address, timezone,
 * and category — data the Apple Maps Server API does not provide.
 *
 * Returns null on Android or when no match is found within 200 m.
 */
export async function searchPOI(
  query: string,
  latitude: number,
  longitude: number,
): Promise<NativeMapKitPoi | null> {
  if (!isAvailable) return null;
  return NativeModule!.searchPOI(query, latitude, longitude);
}
