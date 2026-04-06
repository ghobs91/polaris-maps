import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import type { NativeMapKitPoi } from './NativePolarisMapKit';

export type { NativeMapKitPoi };

// Try TurboModuleRegistry first (New Arch), fall back to NativeModules (interop)
const NativeModule =
  Platform.OS === 'ios'
    ? (TurboModuleRegistry.get('PolarisMapKit') ?? NativeModules.PolarisMapKit ?? null)
    : null;
const isAvailable = NativeModule != null;

if (Platform.OS === 'ios') {
  console.log(
    '[PolarisMapKit] NativeModule available:',
    isAvailable,
    'turbo:',
    !!TurboModuleRegistry.get('PolarisMapKit'),
    'bridge:',
    !!NativeModules.PolarisMapKit,
  );
}

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

/**
 * Search for a place by name using MKLocalSearch, optionally scoped
 * to a region hint (e.g. "Long Island", "Tokyo").
 *
 * The hint is geocoded first so results are biased to that area.
 * Returns the top result with full address/coordinates, or null.
 */
export async function searchPlace(
  query: string,
  regionHint?: string | null,
): Promise<NativeMapKitPoi | null> {
  if (!isAvailable) {
    console.warn('[PolarisMapKit] searchPlace: module not available');
    return null;
  }
  console.log('[PolarisMapKit] searchPlace called:', query, regionHint);
  const result = await NativeModule!.searchPlace(query, regionHint ?? null);
  console.log('[PolarisMapKit] searchPlace result:', result ? result.name : null);
  return result;
}

/**
 * Search for a place by name and return all results (up to 10) for disambiguation.
 */
export async function searchPlaceAll(
  query: string,
  regionHint?: string | null,
): Promise<NativeMapKitPoi[]> {
  if (!isAvailable) return [];
  return NativeModule!.searchPlaceAll(query, regionHint ?? null);
}

/**
 * Search for nearby places using MKLocalSearch, biased to the user's location.
 * Returns up to 20 results with full address/coordinates.
 */
export async function searchNearby(
  query: string,
  latitude: number,
  longitude: number,
  radiusMeters: number = 10000,
): Promise<NativeMapKitPoi[]> {
  if (!isAvailable) return [];
  return NativeModule!.searchNearby(query, latitude, longitude, radiusMeters);
}
