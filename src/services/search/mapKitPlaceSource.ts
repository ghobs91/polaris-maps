/**
 * Apple MapKit POI source for unified search.
 *
 * OSM (Photon/Overpass) and Overture both miss a lot of everyday chain
 * coverage in some metros: a café can be absent from every open dataset while
 * Apple Maps knows it. `MKLocalSearch` already ships in the app for place
 * enrichment; this adapts its nearby search into the shared search engine so
 * iOS gets that coverage in the ranked candidate set instead of as a
 * panel-only afterthought.
 *
 * Android has no MapKit and yields no results — the remaining sources still
 * answer, purely with open data.
 */

import { isMapKitAvailable, searchNearby, type NativeMapKitPoi } from '../../native/mapkit';
import type { OsmPoi } from '../poi/osmFetcher';

/** Radius around the search anchor. Matches the camera-derived search box. */
const MAPKIT_RADIUS_METERS = 15_000;

/** Apple POI categories mapped onto the tags the ranker and row icons read. */
const CATEGORY_TAGS: Record<string, { type: string; subtype: string }> = {
  MKPOICategoryCafe: { type: 'amenity', subtype: 'cafe' },
  MKPOICategoryRestaurant: { type: 'amenity', subtype: 'restaurant' },
  MKPOICategoryBakery: { type: 'shop', subtype: 'bakery' },
  MKPOICategoryFoodMarket: { type: 'shop', subtype: 'supermarket' },
  MKPOICategoryNightlife: { type: 'amenity', subtype: 'bar' },
  MKPOICategoryBrewery: { type: 'craft', subtype: 'brewery' },
  MKPOICategoryStore: { type: 'shop', subtype: 'yes' },
  MKPOICategoryPharmacy: { type: 'amenity', subtype: 'pharmacy' },
  MKPOICategoryHospital: { type: 'amenity', subtype: 'hospital' },
  MKPOICategoryGasStation: { type: 'amenity', subtype: 'fuel' },
  MKPOICategoryParking: { type: 'amenity', subtype: 'parking' },
  MKPOICategoryHotel: { type: 'tourism', subtype: 'hotel' },
  MKPOICategoryAtm: { type: 'amenity', subtype: 'atm' },
  MKPOICategoryBank: { type: 'amenity', subtype: 'bank' },
  MKPOICategoryFitnessCenter: { type: 'leisure', subtype: 'fitness_centre' },
  MKPOICategoryMuseum: { type: 'tourism', subtype: 'museum' },
  MKPOICategoryPark: { type: 'leisure', subtype: 'park' },
};

/** Stable negative id so MapKit rows dedupe and never collide with OSM ids. */
function syntheticId(item: NativeMapKitPoi): number {
  const key = `${item.name ?? ''}|${item.latitude.toFixed(6)}|${item.longitude.toFixed(6)}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return -(Math.abs(hash) % 2_000_000_000) - 1;
}

function toOsmPoi(item: NativeMapKitPoi): OsmPoi | null {
  if (!item.name || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
    return null;
  }
  const shape = CATEGORY_TAGS[item.pointOfInterestCategory ?? ''] ?? {
    type: 'amenity',
    subtype: 'place',
  };
  const tags: Record<string, string> = {
    name: item.name,
    [shape.type]: shape.subtype,
    'polaris:source': 'mapkit',
  };
  if (item.thoroughfare) tags['addr:street'] = item.thoroughfare;
  if (item.subThoroughfare) tags['addr:housenumber'] = item.subThoroughfare;
  if (item.locality) tags['addr:city'] = item.locality;
  if (item.administrativeArea) tags['addr:state'] = item.administrativeArea;
  if (item.postalCode) tags['addr:postcode'] = item.postalCode;
  if (item.country) tags['addr:country'] = item.country;
  if (item.phoneNumber) tags['phone'] = item.phoneNumber;
  if (item.url) tags['website'] = item.url;

  return {
    id: syntheticId(item),
    lat: item.latitude,
    lng: item.longitude,
    name: item.name,
    type: shape.type,
    subtype: shape.subtype,
    tags,
  };
}

/**
 * Search Apple Maps around a point. Returns [] on Android or when the native
 * module is unavailable — source absence, a legitimate empty. A failed native
 * call throws instead: silently converting it to [] would let the search cache
 * negative-log the whole MapKit source for 60 s after one transient error.
 */
export async function searchMapKitPlaces(
  query: string,
  lat: number,
  lng: number,
  limit: number,
  opts?: { signal?: AbortSignal },
): Promise<OsmPoi[]> {
  if (!query.trim() || !isMapKitAvailable() || opts?.signal?.aborted) return [];

  const items = await searchNearby(query, lat, lng, MAPKIT_RADIUS_METERS);
  if (opts?.signal?.aborted) return [];

  const pois: OsmPoi[] = [];
  for (const item of items) {
    const poi = toOsmPoi(item);
    if (poi) pois.push(poi);
    if (pois.length >= limit) break;
  }
  return pois;
}
