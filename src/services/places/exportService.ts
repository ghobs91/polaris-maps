import type { PlaceList } from '../../models/placeList';

/** Export place lists in formats that round-trip with `importService`. */

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV matching the import expectations: Title,Note,Latitude,Longitude,Address,Category,URL. */
export function toCSV(list: PlaceList): string {
  const header = 'Title,Note,Latitude,Longitude,Address,Category,URL';
  const rows = list.places
    .filter((place) => !place.deleted)
    .map((place) =>
      [
        place.name,
        place.note ?? '',
        String(place.lat),
        String(place.lng),
        place.address ?? '',
        place.category ?? '',
        place.googleMapsUrl ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  return [header, ...rows].join('\n');
}

/** GeoJSON FeatureCollection of the list's places (coordinates are [lng, lat]). */
export function toGeoJSON(list: PlaceList): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: list.name,
      features: list.places
        .filter((place) => !place.deleted)
        .map((place) => ({
          type: 'Feature',
          properties: {
            id: place.id,
            name: place.name,
            note: place.note,
            address: place.address,
            category: place.category,
            phone: place.phone,
            website: place.website,
          },
          geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
        })),
    },
    null,
    2,
  );
}

/** Suggested filename without extension (sanitized). */
export function exportFilename(list: PlaceList): string {
  const base = list.name
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base.toLowerCase() : 'places';
}
