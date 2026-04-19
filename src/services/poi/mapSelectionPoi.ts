import type { GeocodingEntry } from '../../models/geocoding';
import type { OsmPoi } from './osmFetcher';

export const MAP_SELECTION_KIND_TAG = 'polaris:selection_kind';
const MAP_SELECTION_KIND = 'map_long_press';

function buildSelectionId(lat: number, lng: number): number {
  const seed = `${lat.toFixed(6)}:${lng.toFixed(6)}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}

function buildSelectionName(entry: GeocodingEntry | null): string {
  if (entry?.housenumber && entry.street) {
    return `${entry.housenumber} ${entry.street}`;
  }
  if (entry?.street) {
    return entry.street;
  }
  if (entry?.city) {
    return entry.city;
  }
  if (entry?.text) {
    return entry.text;
  }
  return 'Dropped Pin';
}

export function createMapSelectionPoi(
  lat: number,
  lng: number,
  entry: GeocodingEntry | null,
): OsmPoi {
  const tags: Record<string, string> = {
    [MAP_SELECTION_KIND_TAG]: MAP_SELECTION_KIND,
    'addr:full': entry?.text ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  };

  if (entry?.housenumber) tags['addr:housenumber'] = entry.housenumber;
  if (entry?.street) tags['addr:street'] = entry.street;
  if (entry?.city) tags['addr:city'] = entry.city;
  if (entry?.state) tags['addr:state'] = entry.state;
  if (entry?.postcode) tags['addr:postcode'] = entry.postcode;
  if (entry?.country) tags['addr:country'] = entry.country;

  return {
    id: buildSelectionId(lat, lng),
    lat,
    lng,
    name: buildSelectionName(entry),
    type: 'place',
    subtype: 'address',
    tags,
  };
}

export async function resolveMapSelectionPoi(lat: number, lng: number): Promise<OsmPoi> {
  const { reverseGeocode } = await import('../geocoding/geocodingService');
  const entry = await reverseGeocode(lat, lng).catch(() => null);
  return createMapSelectionPoi(lat, lng, entry);
}

export function isMapSelectionPoi(poi: OsmPoi | null | undefined): poi is OsmPoi {
  return !!poi && poi.tags[MAP_SELECTION_KIND_TAG] === MAP_SELECTION_KIND;
}
