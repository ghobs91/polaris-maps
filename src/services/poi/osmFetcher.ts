const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export interface OsmPoi {
  id: number;
  lat: number;
  lng: number;
  name: string;
  /** Primary OSM tag key: amenity | shop | tourism | leisure */
  type: string;
  /** Value of that tag e.g. restaurant, cafe, supermarket */
  subtype: string;
  tags: Record<string, string>;
}

/**
 * Fetch named POIs from the OSM Overpass API for a bounding box.
 * Only called when zoom >= 14 to avoid huge result sets.
 */
export async function fetchOsmPois(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmPoi[]> {
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:15];
(
  node["amenity"]["name"](${bbox});
  node["shop"]["name"](${bbox});
  node["tourism"]["name"](${bbox});
  node["leisure"]["name"](${bbox});
);
out body;`;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) throw new Error(`Overpass API ${res.status}`);

  const data = await res.json();

  return (data.elements as any[])
    .filter((el) => el.type === 'node' && el.tags?.name)
    .map((el) => {
      const t = el.tags as Record<string, string>;
      const type = t.amenity ? 'amenity' : t.shop ? 'shop' : t.tourism ? 'tourism' : 'leisure';
      const subtype = t[type] ?? 'place';
      return {
        id: el.id as number,
        lat: el.lat as number,
        lng: el.lon as number,
        name: t.name,
        type,
        subtype,
        tags: t,
      };
    });
}
