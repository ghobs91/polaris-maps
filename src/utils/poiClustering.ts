import type { OsmPoi } from '../services/poi/osmFetcher';

/** A screen-space cluster of nearby POIs. */
export interface PoiCluster {
  lat: number;
  lng: number;
  count: number;
  poiIds: number[];
  /** Most common POI subtype in the cluster (drives the badge color). */
  dominantCategory: string;
}

/** Web-Mercator metres per pixel at a given latitude/zoom (256px tiles). */
export function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Grid cell size in degrees for a target on-screen pixel size. */
export function gridDegreesForPixels(zoom: number, lat: number, pixels = 44): number {
  const metres = metersPerPixel(zoom, lat) * pixels;
  return metres / 111_320;
}

/**
 * Bucket POIs into a lat/lng grid of `gridDegrees`, returning one cluster per
 * occupied cell with its centroid, count, member ids, and dominant subtype.
 * Pure and network-free so it works identically online and offline.
 */
export function clusterPoisForDisplay(pois: readonly OsmPoi[], gridDegrees: number): PoiCluster[] {
  if (pois.length === 0 || gridDegrees <= 0) return [];

  const cells = new Map<string, OsmPoi[]>();
  for (const poi of pois) {
    // Round (not floor) so nearby points straddling a cell boundary still land
    // in the same bucket, which is important for negative coordinates.
    const key = `${Math.round(poi.lng / gridDegrees)}:${Math.round(poi.lat / gridDegrees)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(poi);
    else cells.set(key, [poi]);
  }

  const clusters: PoiCluster[] = [];
  for (const group of cells.values()) {
    let latSum = 0;
    let lngSum = 0;
    const counts = new Map<string, number>();
    for (const poi of group) {
      latSum += poi.lat;
      lngSum += poi.lng;
      counts.set(poi.subtype, (counts.get(poi.subtype) ?? 0) + 1);
    }

    let dominant = group[0].subtype;
    let max = 0;
    for (const [subtype, count] of counts) {
      if (count > max) {
        max = count;
        dominant = subtype;
      }
    }

    clusters.push({
      lat: latSum / group.length,
      lng: lngSum / group.length,
      count: group.length,
      poiIds: group.map((poi) => poi.id),
      dominantCategory: dominant,
    });
  }

  return clusters;
}
