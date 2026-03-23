import type { Region } from '../models/region';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * A node in the Geofabrik region hierarchy.
 *
 * - Continent nodes: no bounds, children = countries
 * - Country nodes without sub-regions: bounds, no children  → leaf/downloadable
 * - Country nodes with sub-regions: bounds, children = sub-regions → downloadable + expandable
 * - Sub-region nodes: bounds, no children → leaf/downloadable
 *
 * Download URL: https://download.geofabrik.de/${node.path}-latest.osm.pbf
 */
export interface GeoNode {
  name: string;
  /** Geofabrik path, e.g. "north-america/us/connecticut" */
  path: string;
  bounds?: GeoBounds;
  children?: GeoNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a GeoNode to a Region that can be passed to downloadRegion(). */
export function geoNodeToRegion(node: GeoNode): Region {
  const bounds = node.bounds ?? { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
  return {
    id: node.path.replace(/\//g, '-'),
    name: node.name,
    bounds,
    version: '1.0',
    downloadStatus: 'none',
    downloadedAt: null,
    lastUpdated: null,
    driveKey: null,
    tilesSizeBytes: null,
    routingSizeBytes: null,
    geocodingSizeBytes: null,
  };
}

/**
 * Walk the tree and return the deepest node whose bounds contain the point.
 * Continent nodes (no bounds) are always traversed. If a country has children
 * but no child matches, the country itself is returned (if in bounds).
 */
export function findDeepestNodeContainingPoint(
  nodes: GeoNode[],
  lat: number,
  lng: number,
): GeoNode | null {
  for (const node of nodes) {
    const inBounds =
      !node.bounds ||
      (lat >= node.bounds.minLat &&
        lat <= node.bounds.maxLat &&
        lng >= node.bounds.minLng &&
        lng <= node.bounds.maxLng);

    if (!inBounds) continue;

    if (node.children?.length) {
      const child = findDeepestNodeContainingPoint(node.children, lat, lng);
      if (child) return child;
      // No child matched, but this node itself is in bounds and downloadable
      if (node.bounds) return node;
    } else if (node.bounds) {
      return node;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Full Geofabrik region tree
// Ordered: Africa, Antarctica, Asia, Australia and Oceania, Central America,
//          Europe, North America, Russian Federation, South America
// ---------------------------------------------------------------------------

export const GEOFABRIK_TREE: GeoNode[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // AFRICA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Africa',
    path: 'africa',
    children: [
      {
        name: 'Algeria',
        path: 'africa/algeria',
        bounds: { minLat: 19.0, maxLat: 37.2, minLng: -8.7, maxLng: 12.0 },
      },
      {
        name: 'Angola',
        path: 'africa/angola',
        bounds: { minLat: -18.1, maxLat: -4.4, minLng: 11.7, maxLng: 24.1 },
      },
      {
        name: 'Benin',
        path: 'africa/benin',
        bounds: { minLat: 6.1, maxLat: 12.4, minLng: 0.8, maxLng: 3.9 },
      },
      {
        name: 'Botswana',
        path: 'africa/botswana',
        bounds: { minLat: -26.9, maxLat: -17.8, minLng: 19.9, maxLng: 29.4 },
      },
      {
        name: 'Burkina Faso',
        path: 'africa/burkina-faso',
        bounds: { minLat: 9.4, maxLat: 15.1, minLng: -5.5, maxLng: 2.4 },
      },
      {
        name: 'Burundi',
        path: 'africa/burundi',
        bounds: { minLat: -4.5, maxLat: -2.3, minLng: 29.0, maxLng: 30.9 },
      },
      {
        name: 'Cameroon',
        path: 'africa/cameroon',
        bounds: { minLat: 1.7, maxLat: 13.1, minLng: 8.5, maxLng: 16.2 },
      },
      {
        name: 'Canary Islands',
        path: 'africa/canary-islands',
        bounds: { minLat: 27.6, maxLat: 29.5, minLng: -18.2, maxLng: -13.4 },
      },
      {
        name: 'Cape Verde',
        path: 'africa/cape-verde',
        bounds: { minLat: 14.8, maxLat: 17.2, minLng: -25.4, maxLng: -22.7 },
      },
      {
        name: 'Central African Republic',
        path: 'africa/central-african-republic',
        bounds: { minLat: 2.2, maxLat: 11.0, minLng: 14.4, maxLng: 27.5 },
      },
      {
        name: 'Chad',
        path: 'africa/chad',
        bounds: { minLat: 7.5, maxLat: 23.5, minLng: 13.5, maxLng: 24.1 },
      },
      {
        name: 'Comoros',
        path: 'africa/comoros',
        bounds: { minLat: -12.4, maxLat: -11.3, minLng: 43.2, maxLng: 44.5 },
      },
      {
        name: 'Congo (Republic of)',
        path: 'africa/congo-brazzaville',
        bounds: { minLat: -5.1, maxLat: 3.8, minLng: 11.2, maxLng: 18.7 },
      },
      {
        name: 'Congo (Democratic Republic)',
        path: 'africa/congo-kinshasa',
        bounds: { minLat: -13.5, maxLat: 5.4, minLng: 12.2, maxLng: 31.3 },
      },
      {
        name: 'Djibouti',
        path: 'africa/djibouti',
        bounds: { minLat: 10.9, maxLat: 12.7, minLng: 41.8, maxLng: 43.4 },
      },
      {
        name: 'Egypt',
        path: 'africa/egypt',
        bounds: { minLat: 21.9, maxLat: 31.7, minLng: 24.7, maxLng: 37.1 },
      },
      {
        name: 'Equatorial Guinea',
        path: 'africa/equatorial-guinea',
        bounds: { minLat: 0.9, maxLat: 3.8, minLng: 8.4, maxLng: 11.4 },
      },
      {
        name: 'Eritrea',
        path: 'africa/eritrea',
        bounds: { minLat: 12.4, maxLat: 18.0, minLng: 36.4, maxLng: 43.2 },
      },
      {
        name: 'Ethiopia',
        path: 'africa/ethiopia',
        bounds: { minLat: 3.4, maxLat: 15.0, minLng: 33.0, maxLng: 48.0 },
      },
      {
        name: 'Gabon',
        path: 'africa/gabon',
        bounds: { minLat: -3.9, maxLat: 2.3, minLng: 8.7, maxLng: 14.6 },
      },
      {
        name: 'Gambia',
        path: 'africa/gambia',
        bounds: { minLat: 13.1, maxLat: 13.8, minLng: -16.8, maxLng: -13.8 },
      },
      {
        name: 'Ghana',
        path: 'africa/ghana',
        bounds: { minLat: 4.7, maxLat: 11.2, minLng: -3.3, maxLng: 1.2 },
      },
      {
        name: 'Guinea',
        path: 'africa/guinea',
        bounds: { minLat: 7.2, maxLat: 12.7, minLng: -15.1, maxLng: -7.7 },
      },
      {
        name: 'Guinea-Bissau',
        path: 'africa/guinea-bissau',
        bounds: { minLat: 10.9, maxLat: 12.7, minLng: -16.8, maxLng: -13.7 },
      },
      {
        name: 'Ivory Coast',
        path: 'africa/ivory-coast',
        bounds: { minLat: 4.3, maxLat: 10.8, minLng: -8.6, maxLng: -2.5 },
      },
      {
        name: 'Kenya',
        path: 'africa/kenya',
        bounds: { minLat: -4.7, maxLat: 4.6, minLng: 34.0, maxLng: 42.0 },
      },
      {
        name: 'Lesotho',
        path: 'africa/lesotho',
        bounds: { minLat: -30.7, maxLat: -28.6, minLng: 27.0, maxLng: 29.5 },
      },
      {
        name: 'Liberia',
        path: 'africa/liberia',
        bounds: { minLat: 4.3, maxLat: 8.6, minLng: -11.5, maxLng: -7.4 },
      },
      {
        name: 'Libya',
        path: 'africa/libya',
        bounds: { minLat: 19.5, maxLat: 33.2, minLng: 9.4, maxLng: 25.2 },
      },
      {
        name: 'Madagascar',
        path: 'africa/madagascar',
        bounds: { minLat: -25.6, maxLat: -12.0, minLng: 43.2, maxLng: 50.5 },
      },
      {
        name: 'Malawi',
        path: 'africa/malawi',
        bounds: { minLat: -17.1, maxLat: -9.4, minLng: 32.7, maxLng: 36.0 },
      },
      {
        name: 'Mali',
        path: 'africa/mali',
        bounds: { minLat: 10.1, maxLat: 25.0, minLng: -12.3, maxLng: 4.3 },
      },
      {
        name: 'Mauritania',
        path: 'africa/mauritania',
        bounds: { minLat: 14.7, maxLat: 27.3, minLng: -17.1, maxLng: -4.8 },
      },
      {
        name: 'Mauritius',
        path: 'africa/mauritius',
        bounds: { minLat: -20.5, maxLat: -20.0, minLng: 57.3, maxLng: 57.8 },
      },
      {
        name: 'Morocco',
        path: 'africa/morocco',
        bounds: { minLat: 27.7, maxLat: 35.9, minLng: -13.2, maxLng: -1.0 },
      },
      {
        name: 'Mozambique',
        path: 'africa/mozambique',
        bounds: { minLat: -26.9, maxLat: -10.5, minLng: 30.2, maxLng: 40.9 },
      },
      {
        name: 'Namibia',
        path: 'africa/namibia',
        bounds: { minLat: -29.1, maxLat: -17.0, minLng: 11.7, maxLng: 25.3 },
      },
      {
        name: 'Niger',
        path: 'africa/niger',
        bounds: { minLat: 11.7, maxLat: 23.5, minLng: 0.2, maxLng: 16.0 },
      },
      {
        name: 'Nigeria',
        path: 'africa/nigeria',
        bounds: { minLat: 4.3, maxLat: 13.9, minLng: 2.7, maxLng: 14.7 },
      },
      {
        name: 'Rwanda',
        path: 'africa/rwanda',
        bounds: { minLat: -2.8, maxLat: -1.0, minLng: 28.9, maxLng: 30.9 },
      },
      {
        name: 'Senegal and Gambia',
        path: 'africa/senegal-and-gambia',
        bounds: { minLat: 12.3, maxLat: 16.7, minLng: -17.6, maxLng: -11.4 },
      },
      {
        name: 'Sierra Leone',
        path: 'africa/sierra-leone',
        bounds: { minLat: 6.9, maxLat: 10.0, minLng: -13.3, maxLng: -10.3 },
      },
      {
        name: 'Somalia',
        path: 'africa/somalia',
        bounds: { minLat: -1.7, maxLat: 12.0, minLng: 40.9, maxLng: 51.4 },
      },
      {
        name: 'South Africa',
        path: 'africa/south-africa',
        bounds: { minLat: -34.9, maxLat: -22.1, minLng: 16.5, maxLng: 33.0 },
      },
      {
        name: 'South Sudan',
        path: 'africa/south-sudan',
        bounds: { minLat: 3.5, maxLat: 12.2, minLng: 24.1, maxLng: 35.5 },
      },
      {
        name: 'Sudan',
        path: 'africa/sudan',
        bounds: { minLat: 8.7, maxLat: 23.1, minLng: 21.8, maxLng: 38.7 },
      },
      {
        name: 'Tanzania',
        path: 'africa/tanzania',
        bounds: { minLat: -11.7, maxLat: -1.0, minLng: 29.3, maxLng: 40.4 },
      },
      {
        name: 'Togo',
        path: 'africa/togo',
        bounds: { minLat: 6.1, maxLat: 11.1, minLng: 0.0, maxLng: 1.9 },
      },
      {
        name: 'Tunisia',
        path: 'africa/tunisia',
        bounds: { minLat: 30.2, maxLat: 37.6, minLng: 7.5, maxLng: 11.6 },
      },
      {
        name: 'Uganda',
        path: 'africa/uganda',
        bounds: { minLat: -1.5, maxLat: 4.3, minLng: 29.5, maxLng: 35.1 },
      },
      {
        name: 'Western Sahara',
        path: 'africa/western-sahara',
        bounds: { minLat: 20.8, maxLat: 27.7, minLng: -17.1, maxLng: -8.7 },
      },
      {
        name: 'Zambia',
        path: 'africa/zambia',
        bounds: { minLat: -18.1, maxLat: -8.2, minLng: 21.9, maxLng: 33.7 },
      },
      {
        name: 'Zimbabwe',
        path: 'africa/zimbabwe',
        bounds: { minLat: -22.4, maxLat: -15.6, minLng: 25.2, maxLng: 33.1 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ANTARCTICA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Antarctica',
    path: 'antarctica',
    bounds: { minLat: -90.0, maxLat: -60.0, minLng: -180.0, maxLng: 180.0 },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ASIA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Asia',
    path: 'asia',
    children: [
      {
        name: 'Afghanistan',
        path: 'asia/afghanistan',
        bounds: { minLat: 29.4, maxLat: 38.5, minLng: 60.5, maxLng: 74.9 },
      },
      {
        name: 'Armenia',
        path: 'asia/armenia',
        bounds: { minLat: 38.8, maxLat: 41.3, minLng: 43.5, maxLng: 46.7 },
      },
      {
        name: 'Azerbaijan',
        path: 'asia/azerbaijan',
        bounds: { minLat: 38.4, maxLat: 41.9, minLng: 44.8, maxLng: 50.4 },
      },
      {
        name: 'Bangladesh',
        path: 'asia/bangladesh',
        bounds: { minLat: 20.7, maxLat: 26.7, minLng: 88.0, maxLng: 92.7 },
      },
      {
        name: 'Bhutan',
        path: 'asia/bhutan',
        bounds: { minLat: 26.7, maxLat: 28.3, minLng: 88.8, maxLng: 92.1 },
      },
      {
        name: 'Cambodia',
        path: 'asia/cambodia',
        bounds: { minLat: 10.4, maxLat: 14.7, minLng: 102.3, maxLng: 107.7 },
      },
      {
        name: 'China',
        path: 'asia/china',
        bounds: { minLat: 18.1, maxLat: 53.6, minLng: 73.6, maxLng: 135.1 },
      },
      {
        name: 'GCC States',
        path: 'asia/gcc-states',
        bounds: { minLat: 14.0, maxLat: 26.2, minLng: 50.8, maxLng: 56.4 },
      },
      {
        name: 'India',
        path: 'asia/india',
        bounds: { minLat: 8.1, maxLat: 37.1, minLng: 68.2, maxLng: 97.4 },
      },
      {
        name: 'Indonesia',
        path: 'asia/indonesia',
        bounds: { minLat: -11.0, maxLat: 6.1, minLng: 95.0, maxLng: 141.0 },
      },
      {
        name: 'Iran',
        path: 'asia/iran',
        bounds: { minLat: 25.1, maxLat: 39.8, minLng: 44.0, maxLng: 63.3 },
      },
      {
        name: 'Iraq',
        path: 'asia/iraq',
        bounds: { minLat: 29.1, maxLat: 37.4, minLng: 38.8, maxLng: 48.6 },
      },
      {
        name: 'Israel and Palestine',
        path: 'asia/israel-and-palestine',
        bounds: { minLat: 29.5, maxLat: 33.3, minLng: 34.2, maxLng: 35.9 },
      },
      {
        name: 'Japan',
        path: 'asia/japan',
        bounds: { minLat: 24.2, maxLat: 45.6, minLng: 122.9, maxLng: 153.1 },
      },
      {
        name: 'Jordan',
        path: 'asia/jordan',
        bounds: { minLat: 29.2, maxLat: 33.4, minLng: 35.0, maxLng: 39.3 },
      },
      {
        name: 'Kazakhstan',
        path: 'asia/kazakhstan',
        bounds: { minLat: 40.6, maxLat: 55.4, minLng: 50.3, maxLng: 87.4 },
      },
      {
        name: 'Kyrgyzstan',
        path: 'asia/kyrgyzstan',
        bounds: { minLat: 39.2, maxLat: 43.3, minLng: 69.3, maxLng: 80.3 },
      },
      {
        name: 'Laos',
        path: 'asia/laos',
        bounds: { minLat: 13.9, maxLat: 22.5, minLng: 100.1, maxLng: 107.7 },
      },
      {
        name: 'Lebanon',
        path: 'asia/lebanon',
        bounds: { minLat: 33.1, maxLat: 34.7, minLng: 35.1, maxLng: 36.6 },
      },
      {
        name: 'Malaysia, Singapore, and Brunei',
        path: 'asia/malaysia-singapore-brunei',
        bounds: { minLat: 0.9, maxLat: 7.4, minLng: 99.6, maxLng: 119.3 },
      },
      {
        name: 'Maldives',
        path: 'asia/maldives',
        bounds: { minLat: -0.7, maxLat: 7.2, minLng: 72.7, maxLng: 73.8 },
      },
      {
        name: 'Mongolia',
        path: 'asia/mongolia',
        bounds: { minLat: 41.6, maxLat: 52.2, minLng: 87.6, maxLng: 120.0 },
      },
      {
        name: 'Myanmar',
        path: 'asia/myanmar',
        bounds: { minLat: 9.6, maxLat: 28.6, minLng: 92.2, maxLng: 101.2 },
      },
      {
        name: 'Nepal',
        path: 'asia/nepal',
        bounds: { minLat: 26.4, maxLat: 30.5, minLng: 80.1, maxLng: 88.2 },
      },
      {
        name: 'North Korea',
        path: 'asia/north-korea',
        bounds: { minLat: 37.7, maxLat: 43.0, minLng: 124.2, maxLng: 130.7 },
      },
      {
        name: 'Oman',
        path: 'asia/oman',
        bounds: { minLat: 16.6, maxLat: 26.4, minLng: 52.0, maxLng: 59.9 },
      },
      {
        name: 'Pakistan',
        path: 'asia/pakistan',
        bounds: { minLat: 23.7, maxLat: 37.1, minLng: 60.9, maxLng: 77.1 },
      },
      {
        name: 'Philippines',
        path: 'asia/philippines',
        bounds: { minLat: 5.0, maxLat: 21.1, minLng: 117.2, maxLng: 126.6 },
      },
      {
        name: 'South Korea',
        path: 'asia/south-korea',
        bounds: { minLat: 33.1, maxLat: 38.6, minLng: 125.9, maxLng: 129.6 },
      },
      {
        name: 'Sri Lanka',
        path: 'asia/sri-lanka',
        bounds: { minLat: 5.9, maxLat: 9.8, minLng: 79.7, maxLng: 81.9 },
      },
      {
        name: 'Syria',
        path: 'asia/syria',
        bounds: { minLat: 32.3, maxLat: 37.3, minLng: 35.7, maxLng: 42.4 },
      },
      {
        name: 'Taiwan',
        path: 'asia/taiwan',
        bounds: { minLat: 21.9, maxLat: 25.3, minLng: 120.0, maxLng: 122.1 },
      },
      {
        name: 'Tajikistan',
        path: 'asia/tajikistan',
        bounds: { minLat: 36.7, maxLat: 41.1, minLng: 67.4, maxLng: 75.2 },
      },
      {
        name: 'Thailand',
        path: 'asia/thailand',
        bounds: { minLat: 5.6, maxLat: 20.5, minLng: 97.3, maxLng: 105.7 },
      },
      {
        name: 'Timor-Leste',
        path: 'asia/east-timor',
        bounds: { minLat: -9.5, maxLat: -8.1, minLng: 124.0, maxLng: 127.3 },
      },
      {
        name: 'Turkmenistan',
        path: 'asia/turkmenistan',
        bounds: { minLat: 35.1, maxLat: 42.8, minLng: 52.5, maxLng: 66.7 },
      },
      {
        name: 'Uzbekistan',
        path: 'asia/uzbekistan',
        bounds: { minLat: 37.2, maxLat: 45.6, minLng: 56.0, maxLng: 73.1 },
      },
      {
        name: 'Vietnam',
        path: 'asia/vietnam',
        bounds: { minLat: 8.5, maxLat: 23.3, minLng: 102.1, maxLng: 109.5 },
      },
      {
        name: 'Yemen',
        path: 'asia/yemen',
        bounds: { minLat: 12.6, maxLat: 19.0, minLng: 42.7, maxLng: 54.9 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AUSTRALIA AND OCEANIA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Australia and Oceania',
    path: 'australia-oceania',
    children: [
      {
        name: 'American Oceania',
        path: 'australia-oceania/american-oceania',
        bounds: { minLat: -14.5, maxLat: -11.0, minLng: -171.1, maxLng: -168.1 },
      },
      {
        name: 'Australia',
        path: 'australia-oceania/australia',
        bounds: { minLat: -43.7, maxLat: -10.7, minLng: 113.3, maxLng: 153.7 },
      },
      {
        name: 'Cook Islands',
        path: 'australia-oceania/cook-islands',
        bounds: { minLat: -21.9, maxLat: -18.8, minLng: -160.0, maxLng: -157.3 },
      },
      {
        name: 'Fiji',
        path: 'australia-oceania/fiji',
        bounds: { minLat: -20.7, maxLat: -12.5, minLng: 177.0, maxLng: 180.0 },
      },
      {
        name: 'Kiribati',
        path: 'australia-oceania/kiribati',
        bounds: { minLat: -11.5, maxLat: 3.9, minLng: -175.0, maxLng: 177.0 },
      },
      {
        name: 'Marshall Islands',
        path: 'australia-oceania/marshall-islands',
        bounds: { minLat: 4.6, maxLat: 14.6, minLng: 160.8, maxLng: 172.0 },
      },
      {
        name: 'Micronesia',
        path: 'australia-oceania/micronesia',
        bounds: { minLat: 1.0, maxLat: 10.0, minLng: 138.0, maxLng: 163.0 },
      },
      {
        name: 'Nauru',
        path: 'australia-oceania/nauru',
        bounds: { minLat: -0.6, maxLat: -0.3, minLng: 166.8, maxLng: 167.0 },
      },
      {
        name: 'New Caledonia',
        path: 'australia-oceania/new-caledonia',
        bounds: { minLat: -22.7, maxLat: -19.6, minLng: 163.6, maxLng: 168.1 },
      },
      {
        name: 'New Zealand',
        path: 'australia-oceania/new-zealand',
        bounds: { minLat: -47.3, maxLat: -34.4, minLng: 166.4, maxLng: 178.6 },
      },
      {
        name: 'Niue',
        path: 'australia-oceania/niue',
        bounds: { minLat: -19.2, maxLat: -18.9, minLng: -170.0, maxLng: -169.8 },
      },
      {
        name: 'Norfolk Island',
        path: 'australia-oceania/norfolk-island',
        bounds: { minLat: -29.1, maxLat: -28.9, minLng: 167.9, maxLng: 168.0 },
      },
      {
        name: 'Palau',
        path: 'australia-oceania/palau',
        bounds: { minLat: 3.0, maxLat: 8.2, minLng: 131.1, maxLng: 134.7 },
      },
      {
        name: 'Papua New Guinea',
        path: 'australia-oceania/papua-new-guinea',
        bounds: { minLat: -11.5, maxLat: 0.0, minLng: 140.8, maxLng: 156.0 },
      },
      {
        name: 'Samoa',
        path: 'australia-oceania/samoa',
        bounds: { minLat: -14.1, maxLat: -13.4, minLng: -172.8, maxLng: -171.4 },
      },
      {
        name: 'Solomon Islands',
        path: 'australia-oceania/solomon-islands',
        bounds: { minLat: -11.3, maxLat: -6.6, minLng: 155.5, maxLng: 163.2 },
      },
      {
        name: 'Tokelau',
        path: 'australia-oceania/tokelau',
        bounds: { minLat: -9.5, maxLat: -8.5, minLng: -172.5, maxLng: -171.2 },
      },
      {
        name: 'Tonga',
        path: 'australia-oceania/tonga',
        bounds: { minLat: -22.3, maxLat: -15.6, minLng: -176.2, maxLng: -173.9 },
      },
      {
        name: 'Tuvalu',
        path: 'australia-oceania/tuvalu',
        bounds: { minLat: -10.8, maxLat: -5.7, minLng: 176.1, maxLng: 179.9 },
      },
      {
        name: 'Vanuatu',
        path: 'australia-oceania/vanuatu',
        bounds: { minLat: -20.3, maxLat: -13.1, minLng: 166.5, maxLng: 170.3 },
      },
      {
        name: 'Wallis et Futuna',
        path: 'australia-oceania/wallis-et-futuna',
        bounds: { minLat: -14.4, maxLat: -13.2, minLng: -178.2, maxLng: -176.1 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CENTRAL AMERICA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Central America',
    path: 'central-america',
    children: [
      {
        name: 'Bahamas',
        path: 'central-america/bahamas',
        bounds: { minLat: 20.9, maxLat: 27.3, minLng: -79.3, maxLng: -72.7 },
      },
      {
        name: 'Belize',
        path: 'central-america/belize',
        bounds: { minLat: 15.9, maxLat: 18.5, minLng: -89.2, maxLng: -87.8 },
      },
      {
        name: 'Costa Rica',
        path: 'central-america/costa-rica',
        bounds: { minLat: 8.0, maxLat: 11.2, minLng: -85.9, maxLng: -82.6 },
      },
      {
        name: 'Cuba',
        path: 'central-america/cuba',
        bounds: { minLat: 19.8, maxLat: 23.2, minLng: -85.0, maxLng: -74.1 },
      },
      {
        name: 'El Salvador',
        path: 'central-america/el-salvador',
        bounds: { minLat: 13.1, maxLat: 14.5, minLng: -90.2, maxLng: -87.7 },
      },
      {
        name: 'Guatemala',
        path: 'central-america/guatemala',
        bounds: { minLat: 13.7, maxLat: 18.0, minLng: -92.2, maxLng: -88.2 },
      },
      {
        name: 'Haiti and Dominican Republic',
        path: 'central-america/haiti-and-domrep',
        bounds: { minLat: 17.5, maxLat: 20.2, minLng: -74.5, maxLng: -68.3 },
      },
      {
        name: 'Honduras',
        path: 'central-america/honduras',
        bounds: { minLat: 12.9, maxLat: 16.0, minLng: -89.4, maxLng: -83.2 },
      },
      {
        name: 'Jamaica',
        path: 'central-america/jamaica',
        bounds: { minLat: 17.7, maxLat: 18.5, minLng: -78.4, maxLng: -76.2 },
      },
      {
        name: 'Nicaragua',
        path: 'central-america/nicaragua',
        bounds: { minLat: 11.0, maxLat: 15.0, minLng: -87.7, maxLng: -83.2 },
      },
      {
        name: 'Panama',
        path: 'central-america/panama',
        bounds: { minLat: 7.2, maxLat: 9.7, minLng: -83.0, maxLng: -77.2 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EUROPE
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Europe',
    path: 'europe',
    children: [
      {
        name: 'Albania',
        path: 'europe/albania',
        bounds: { minLat: 39.6, maxLat: 42.7, minLng: 19.3, maxLng: 21.1 },
      },
      {
        name: 'Andorra',
        path: 'europe/andorra',
        bounds: { minLat: 42.4, maxLat: 42.7, minLng: 1.4, maxLng: 1.8 },
      },
      {
        name: 'Austria',
        path: 'europe/austria',
        bounds: { minLat: 46.4, maxLat: 49.0, minLng: 9.5, maxLng: 17.2 },
      },
      {
        name: 'Azores',
        path: 'europe/azores',
        bounds: { minLat: 36.9, maxLat: 39.8, minLng: -31.3, maxLng: -25.0 },
      },
      {
        name: 'Belarus',
        path: 'europe/belarus',
        bounds: { minLat: 51.3, maxLat: 56.2, minLng: 23.2, maxLng: 32.8 },
      },
      {
        name: 'Belgium',
        path: 'europe/belgium',
        bounds: { minLat: 49.5, maxLat: 51.5, minLng: 2.5, maxLng: 6.4 },
      },
      {
        name: 'Bosnia-Herzegovina',
        path: 'europe/bosnia-herzegovina',
        bounds: { minLat: 42.6, maxLat: 45.3, minLng: 15.7, maxLng: 19.7 },
      },
      {
        name: 'Bulgaria',
        path: 'europe/bulgaria',
        bounds: { minLat: 41.2, maxLat: 44.2, minLng: 22.4, maxLng: 28.6 },
      },
      {
        name: 'Croatia',
        path: 'europe/croatia',
        bounds: { minLat: 42.4, maxLat: 46.6, minLng: 13.5, maxLng: 19.5 },
      },
      {
        name: 'Cyprus',
        path: 'europe/cyprus',
        bounds: { minLat: 34.6, maxLat: 35.7, minLng: 32.3, maxLng: 34.6 },
      },
      {
        name: 'Czech Republic',
        path: 'europe/czech-republic',
        bounds: { minLat: 48.6, maxLat: 51.1, minLng: 12.1, maxLng: 18.9 },
      },
      {
        name: 'Denmark',
        path: 'europe/denmark',
        bounds: { minLat: 54.6, maxLat: 57.8, minLng: 8.1, maxLng: 15.2 },
      },
      {
        name: 'Estonia',
        path: 'europe/estonia',
        bounds: { minLat: 57.5, maxLat: 59.7, minLng: 21.8, maxLng: 28.2 },
      },
      {
        name: 'Faroe Islands',
        path: 'europe/faroe-islands',
        bounds: { minLat: 61.3, maxLat: 62.4, minLng: -7.7, maxLng: -6.2 },
      },
      {
        name: 'Finland',
        path: 'europe/finland',
        bounds: { minLat: 59.8, maxLat: 70.1, minLng: 20.0, maxLng: 31.6 },
      },
      {
        name: 'France',
        path: 'europe/france',
        bounds: { minLat: 41.3, maxLat: 51.1, minLng: -5.1, maxLng: 9.6 },
        children: [
          {
            name: 'Alsace',
            path: 'europe/france/alsace',
            bounds: { minLat: 47.4, maxLat: 48.9, minLng: 7.1, maxLng: 8.3 },
          },
          {
            name: 'Aquitaine',
            path: 'europe/france/aquitaine',
            bounds: { minLat: 43.3, maxLat: 45.7, minLng: -1.8, maxLng: 1.1 },
          },
          {
            name: 'Auvergne',
            path: 'europe/france/auvergne',
            bounds: { minLat: 44.7, maxLat: 46.8, minLng: 2.1, maxLng: 4.1 },
          },
          {
            name: 'Basse-Normandie',
            path: 'europe/france/basse-normandie',
            bounds: { minLat: 48.3, maxLat: 49.7, minLng: -1.8, maxLng: 0.8 },
          },
          {
            name: 'Bourgogne',
            path: 'europe/france/bourgogne',
            bounds: { minLat: 46.2, maxLat: 48.2, minLng: 3.4, maxLng: 5.5 },
          },
          {
            name: 'Bretagne',
            path: 'europe/france/bretagne',
            bounds: { minLat: 47.3, maxLat: 48.9, minLng: -5.2, maxLng: -1.1 },
          },
          {
            name: 'Centre',
            path: 'europe/france/centre',
            bounds: { minLat: 46.4, maxLat: 48.5, minLng: 0.1, maxLng: 3.2 },
          },
          {
            name: 'Champagne Ardenne',
            path: 'europe/france/champagne-ardenne',
            bounds: { minLat: 47.6, maxLat: 50.2, minLng: 3.0, maxLng: 5.9 },
          },
          {
            name: 'Corse',
            path: 'europe/france/corse',
            bounds: { minLat: 41.3, maxLat: 43.0, minLng: 8.5, maxLng: 9.6 },
          },
          {
            name: 'Franche Comte',
            path: 'europe/france/franche-comte',
            bounds: { minLat: 46.3, maxLat: 48.0, minLng: 5.8, maxLng: 7.1 },
          },
          {
            name: 'Guadeloupe',
            path: 'europe/france/guadeloupe',
            bounds: { minLat: 15.8, maxLat: 16.5, minLng: -61.9, maxLng: -61.0 },
          },
          {
            name: 'Guyane',
            path: 'europe/france/guyane',
            bounds: { minLat: 2.1, maxLat: 5.8, minLng: -54.6, maxLng: -51.7 },
          },
          {
            name: 'Haute-Normandie',
            path: 'europe/france/haute-normandie',
            bounds: { minLat: 48.7, maxLat: 50.0, minLng: 0.1, maxLng: 1.9 },
          },
          {
            name: 'Ile-de-France',
            path: 'europe/france/ile-de-france',
            bounds: { minLat: 48.1, maxLat: 49.2, minLng: 1.4, maxLng: 3.2 },
          },
          {
            name: 'Languedoc-Roussillon',
            path: 'europe/france/languedoc-roussillon',
            bounds: { minLat: 42.3, maxLat: 44.8, minLng: 2.0, maxLng: 4.9 },
          },
          {
            name: 'Limousin',
            path: 'europe/france/limousin',
            bounds: { minLat: 44.9, maxLat: 46.4, minLng: 0.8, maxLng: 2.5 },
          },
          {
            name: 'Lorraine',
            path: 'europe/france/lorraine',
            bounds: { minLat: 48.0, maxLat: 50.0, minLng: 5.7, maxLng: 7.7 },
          },
          {
            name: 'Martinique',
            path: 'europe/france/martinique',
            bounds: { minLat: 14.4, maxLat: 14.9, minLng: -61.3, maxLng: -60.9 },
          },
          {
            name: 'Mayotte',
            path: 'europe/france/mayotte',
            bounds: { minLat: -13.1, maxLat: -12.6, minLng: 44.9, maxLng: 45.3 },
          },
          {
            name: 'Midi-Pyrenees',
            path: 'europe/france/midi-pyrenees',
            bounds: { minLat: 42.6, maxLat: 45.1, minLng: 0.2, maxLng: 3.3 },
          },
          {
            name: 'Nord-Pas-de-Calais',
            path: 'europe/france/nord-pas-de-calais',
            bounds: { minLat: 50.0, maxLat: 51.1, minLng: 1.7, maxLng: 4.3 },
          },
          {
            name: 'Pays de la Loire',
            path: 'europe/france/pays-de-la-loire',
            bounds: { minLat: 46.5, maxLat: 48.5, minLng: -2.6, maxLng: 0.2 },
          },
          {
            name: 'Picardie',
            path: 'europe/france/picardie',
            bounds: { minLat: 48.9, maxLat: 50.5, minLng: 1.6, maxLng: 4.2 },
          },
          {
            name: 'Poitou-Charentes',
            path: 'europe/france/poitou-charentes',
            bounds: { minLat: 45.0, maxLat: 47.3, minLng: -1.5, maxLng: 0.6 },
          },
          {
            name: "Provence Alpes-Cote-d'Azur",
            path: 'europe/france/provence-alpes-cote-d-azur',
            bounds: { minLat: 43.3, maxLat: 45.1, minLng: 4.2, maxLng: 7.8 },
          },
          {
            name: 'Reunion',
            path: 'europe/france/reunion',
            bounds: { minLat: -21.4, maxLat: -20.9, minLng: 55.2, maxLng: 55.8 },
          },
          {
            name: 'Rhone-Alpes',
            path: 'europe/france/rhone-alpes',
            bounds: { minLat: 44.1, maxLat: 46.8, minLng: 4.3, maxLng: 7.3 },
          },
        ],
      },
      {
        name: 'Georgia',
        path: 'europe/georgia',
        bounds: { minLat: 41.0, maxLat: 43.6, minLng: 40.0, maxLng: 46.7 },
      },
      {
        name: 'Germany',
        path: 'europe/germany',
        bounds: { minLat: 47.3, maxLat: 55.1, minLng: 5.9, maxLng: 15.1 },
        children: [
          {
            name: 'Baden-Württemberg',
            path: 'europe/germany/baden-wuerttemberg',
            bounds: { minLat: 47.5, maxLat: 49.8, minLng: 7.5, maxLng: 10.5 },
          },
          {
            name: 'Bayern',
            path: 'europe/germany/bayern',
            bounds: { minLat: 47.3, maxLat: 50.6, minLng: 9.0, maxLng: 13.9 },
          },
          {
            name: 'Berlin',
            path: 'europe/germany/berlin',
            bounds: { minLat: 52.3, maxLat: 52.7, minLng: 13.1, maxLng: 13.8 },
          },
          {
            name: 'Brandenburg',
            path: 'europe/germany/brandenburg',
            bounds: { minLat: 51.4, maxLat: 53.6, minLng: 11.3, maxLng: 15.0 },
          },
          {
            name: 'Bremen',
            path: 'europe/germany/bremen',
            bounds: { minLat: 53.0, maxLat: 53.6, minLng: 8.5, maxLng: 9.0 },
          },
          {
            name: 'Hamburg',
            path: 'europe/germany/hamburg',
            bounds: { minLat: 53.3, maxLat: 53.7, minLng: 9.7, maxLng: 10.4 },
          },
          {
            name: 'Hessen',
            path: 'europe/germany/hessen',
            bounds: { minLat: 49.4, maxLat: 51.7, minLng: 7.8, maxLng: 10.2 },
          },
          {
            name: 'Mecklenburg-Vorpommern',
            path: 'europe/germany/mecklenburg-vorpommern',
            bounds: { minLat: 53.1, maxLat: 54.7, minLng: 10.6, maxLng: 14.5 },
          },
          {
            name: 'Niedersachsen',
            path: 'europe/germany/niedersachsen',
            bounds: { minLat: 51.3, maxLat: 53.9, minLng: 6.7, maxLng: 11.6 },
          },
          {
            name: 'Nordrhein-Westfalen',
            path: 'europe/germany/nordrhein-westfalen',
            bounds: { minLat: 50.3, maxLat: 52.5, minLng: 5.9, maxLng: 9.5 },
          },
          {
            name: 'Rheinland-Pfalz',
            path: 'europe/germany/rheinland-pfalz',
            bounds: { minLat: 49.1, maxLat: 51.0, minLng: 6.1, maxLng: 8.5 },
          },
          {
            name: 'Saarland',
            path: 'europe/germany/saarland',
            bounds: { minLat: 49.1, maxLat: 49.6, minLng: 6.4, maxLng: 7.4 },
          },
          {
            name: 'Sachsen',
            path: 'europe/germany/sachsen',
            bounds: { minLat: 50.2, maxLat: 51.7, minLng: 11.9, maxLng: 15.1 },
          },
          {
            name: 'Sachsen-Anhalt',
            path: 'europe/germany/sachsen-anhalt',
            bounds: { minLat: 51.0, maxLat: 53.1, minLng: 10.6, maxLng: 13.2 },
          },
          {
            name: 'Schleswig-Holstein',
            path: 'europe/germany/schleswig-holstein',
            bounds: { minLat: 53.4, maxLat: 55.1, minLng: 8.0, maxLng: 11.0 },
          },
          {
            name: 'Thüringen',
            path: 'europe/germany/thueringen',
            bounds: { minLat: 50.2, maxLat: 51.7, minLng: 9.9, maxLng: 12.7 },
          },
        ],
      },
      {
        name: 'Greece',
        path: 'europe/greece',
        bounds: { minLat: 34.8, maxLat: 42.0, minLng: 20.0, maxLng: 26.6 },
      },
      {
        name: 'Hungary',
        path: 'europe/hungary',
        bounds: { minLat: 45.7, maxLat: 48.6, minLng: 16.1, maxLng: 22.9 },
      },
      {
        name: 'Iceland',
        path: 'europe/iceland',
        bounds: { minLat: 63.3, maxLat: 66.6, minLng: -24.6, maxLng: -13.5 },
      },
      {
        name: 'Ireland and Northern Ireland',
        path: 'europe/ireland-and-northern-ireland',
        bounds: { minLat: 51.4, maxLat: 55.4, minLng: -10.5, maxLng: -6.0 },
      },
      {
        name: 'Isle of Man',
        path: 'europe/isle-of-man',
        bounds: { minLat: 54.0, maxLat: 54.5, minLng: -4.8, maxLng: -4.3 },
      },
      {
        name: 'Italy',
        path: 'europe/italy',
        bounds: { minLat: 36.6, maxLat: 47.1, minLng: 6.6, maxLng: 18.5 },
        children: [
          {
            name: 'Centro',
            path: 'europe/italy/centro',
            bounds: { minLat: 41.2, maxLat: 44.2, minLng: 10.8, maxLng: 15.0 },
          },
          {
            name: 'Isole',
            path: 'europe/italy/isole',
            bounds: { minLat: 36.6, maxLat: 41.7, minLng: 8.2, maxLng: 15.7 },
          },
          {
            name: 'Nord-Est',
            path: 'europe/italy/nord-est',
            bounds: { minLat: 44.8, maxLat: 47.1, minLng: 10.6, maxLng: 13.9 },
          },
          {
            name: 'Nord-Ovest',
            path: 'europe/italy/nord-ovest',
            bounds: { minLat: 43.8, maxLat: 46.2, minLng: 6.6, maxLng: 10.4 },
          },
          {
            name: 'Sud',
            path: 'europe/italy/sud',
            bounds: { minLat: 37.9, maxLat: 41.6, minLng: 14.1, maxLng: 18.5 },
          },
        ],
      },
      {
        name: 'Kosovo',
        path: 'europe/kosovo',
        bounds: { minLat: 41.9, maxLat: 43.3, minLng: 20.0, maxLng: 21.8 },
      },
      {
        name: 'Latvia',
        path: 'europe/latvia',
        bounds: { minLat: 55.7, maxLat: 58.1, minLng: 20.9, maxLng: 28.2 },
      },
      {
        name: 'Liechtenstein',
        path: 'europe/liechtenstein',
        bounds: { minLat: 47.1, maxLat: 47.3, minLng: 9.5, maxLng: 9.6 },
      },
      {
        name: 'Lithuania',
        path: 'europe/lithuania',
        bounds: { minLat: 53.9, maxLat: 56.5, minLng: 21.0, maxLng: 26.8 },
      },
      {
        name: 'Luxembourg',
        path: 'europe/luxembourg',
        bounds: { minLat: 49.4, maxLat: 50.2, minLng: 5.7, maxLng: 6.5 },
      },
      {
        name: 'Macedonia',
        path: 'europe/macedonia',
        bounds: { minLat: 40.9, maxLat: 42.4, minLng: 20.5, maxLng: 23.0 },
      },
      {
        name: 'Malta',
        path: 'europe/malta',
        bounds: { minLat: 35.8, maxLat: 36.1, minLng: 14.2, maxLng: 14.6 },
      },
      {
        name: 'Moldova',
        path: 'europe/moldova',
        bounds: { minLat: 45.5, maxLat: 48.2, minLng: 26.6, maxLng: 30.2 },
      },
      {
        name: 'Monaco',
        path: 'europe/monaco',
        bounds: { minLat: 43.7, maxLat: 43.8, minLng: 7.4, maxLng: 7.5 },
      },
      {
        name: 'Montenegro',
        path: 'europe/montenegro',
        bounds: { minLat: 41.9, maxLat: 43.6, minLng: 18.4, maxLng: 20.4 },
      },
      {
        name: 'Netherlands',
        path: 'europe/netherlands',
        bounds: { minLat: 50.8, maxLat: 53.6, minLng: 3.4, maxLng: 7.2 },
      },
      {
        name: 'Norway',
        path: 'europe/norway',
        bounds: { minLat: 57.9, maxLat: 71.2, minLng: 4.1, maxLng: 31.1 },
      },
      {
        name: 'Poland',
        path: 'europe/poland',
        bounds: { minLat: 49.0, maxLat: 54.9, minLng: 14.1, maxLng: 24.2 },
      },
      {
        name: 'Portugal',
        path: 'europe/portugal',
        bounds: { minLat: 36.9, maxLat: 42.2, minLng: -9.5, maxLng: -6.2 },
      },
      {
        name: 'Romania',
        path: 'europe/romania',
        bounds: { minLat: 43.6, maxLat: 48.3, minLng: 20.3, maxLng: 30.0 },
      },
      {
        name: 'Russian Federation',
        path: 'russia',
        bounds: { minLat: 41.0, maxLat: 81.9, minLng: 19.6, maxLng: 180.0 },
        children: [
          {
            name: 'Central Federal District',
            path: 'russia/central-fed-district',
            bounds: { minLat: 53.5, maxLat: 58.5, minLng: 32.0, maxLng: 41.0 },
          },
          {
            name: 'Crimean Federal District',
            path: 'russia/crimean-fed-district',
            bounds: { minLat: 44.4, maxLat: 46.2, minLng: 32.5, maxLng: 36.7 },
          },
          {
            name: 'Far Eastern Federal District',
            path: 'russia/far-eastern-fed-district',
            bounds: { minLat: 42.0, maxLat: 72.0, minLng: 131.0, maxLng: 180.0 },
          },
          {
            name: 'North Caucasus Federal District',
            path: 'russia/north-caucasus-fed-district',
            bounds: { minLat: 41.0, maxLat: 46.0, minLng: 40.0, maxLng: 48.0 },
          },
          {
            name: 'Northwestern Federal District',
            path: 'russia/northwestern-fed-district',
            bounds: { minLat: 58.0, maxLat: 70.0, minLng: 26.0, maxLng: 62.0 },
          },
          {
            name: 'Siberian Federal District',
            path: 'russia/siberian-fed-district',
            bounds: { minLat: 50.0, maxLat: 72.0, minLng: 60.0, maxLng: 111.0 },
          },
          {
            name: 'South Federal District',
            path: 'russia/south-fed-district',
            bounds: { minLat: 44.0, maxLat: 51.0, minLng: 36.0, maxLng: 50.0 },
          },
          {
            name: 'Ural Federal District',
            path: 'russia/ural-fed-district',
            bounds: { minLat: 54.5, maxLat: 70.0, minLng: 58.0, maxLng: 68.0 },
          },
          {
            name: 'Volga Federal District',
            path: 'russia/volga-fed-district',
            bounds: { minLat: 51.0, maxLat: 59.5, minLng: 44.0, maxLng: 57.0 },
          },
          {
            name: 'Kaliningrad',
            path: 'russia/kaliningrad',
            bounds: { minLat: 54.3, maxLat: 55.3, minLng: 19.6, maxLng: 22.9 },
          },
        ],
      },
      {
        name: 'San Marino',
        path: 'europe/san-marino',
        bounds: { minLat: 43.9, maxLat: 44.0, minLng: 12.4, maxLng: 12.5 },
      },
      {
        name: 'Serbia',
        path: 'europe/serbia',
        bounds: { minLat: 42.2, maxLat: 46.2, minLng: 18.8, maxLng: 23.0 },
      },
      {
        name: 'Slovakia',
        path: 'europe/slovakia',
        bounds: { minLat: 47.7, maxLat: 49.6, minLng: 16.8, maxLng: 22.6 },
      },
      {
        name: 'Slovenia',
        path: 'europe/slovenia',
        bounds: { minLat: 45.4, maxLat: 46.9, minLng: 13.4, maxLng: 16.6 },
      },
      {
        name: 'Spain',
        path: 'europe/spain',
        bounds: { minLat: 35.9, maxLat: 43.8, minLng: -9.3, maxLng: 4.3 },
        children: [
          {
            name: 'Andalucía',
            path: 'europe/spain/andalucia',
            bounds: { minLat: 36.0, maxLat: 38.7, minLng: -7.5, maxLng: -1.6 },
          },
          {
            name: 'Aragón',
            path: 'europe/spain/aragon',
            bounds: { minLat: 40.0, maxLat: 42.9, minLng: -1.9, maxLng: 0.7 },
          },
          {
            name: 'Asturias',
            path: 'europe/spain/asturias',
            bounds: { minLat: 42.9, maxLat: 43.7, minLng: -7.1, maxLng: -4.6 },
          },
          {
            name: 'Cantabria',
            path: 'europe/spain/cantabria',
            bounds: { minLat: 42.8, maxLat: 43.6, minLng: -4.9, maxLng: -3.6 },
          },
          {
            name: 'Castilla-La Mancha',
            path: 'europe/spain/castilla-la-mancha',
            bounds: { minLat: 37.9, maxLat: 41.4, minLng: -5.4, maxLng: -0.9 },
          },
          {
            name: 'Castilla y León',
            path: 'europe/spain/castilla-y-leon',
            bounds: { minLat: 40.5, maxLat: 43.1, minLng: -7.0, maxLng: -2.0 },
          },
          {
            name: 'Cataluña',
            path: 'europe/spain/cataluna',
            bounds: { minLat: 40.5, maxLat: 42.9, minLng: 0.2, maxLng: 3.3 },
          },
          {
            name: 'Ceuta',
            path: 'europe/spain/ceuta',
            bounds: { minLat: 35.8, maxLat: 35.9, minLng: -5.4, maxLng: -5.3 },
          },
          {
            name: 'Extremadura',
            path: 'europe/spain/extremadura',
            bounds: { minLat: 37.9, maxLat: 40.5, minLng: -7.6, maxLng: -4.6 },
          },
          {
            name: 'Galicia',
            path: 'europe/spain/galicia',
            bounds: { minLat: 41.8, maxLat: 43.8, minLng: -9.3, maxLng: -6.7 },
          },
          {
            name: 'Islas Baleares',
            path: 'europe/spain/islas-baleares',
            bounds: { minLat: 38.7, maxLat: 40.1, minLng: 1.2, maxLng: 4.4 },
          },
          {
            name: 'La Rioja',
            path: 'europe/spain/la-rioja',
            bounds: { minLat: 41.9, maxLat: 42.7, minLng: -3.2, maxLng: -1.8 },
          },
          {
            name: 'Madrid',
            path: 'europe/spain/madrid',
            bounds: { minLat: 39.9, maxLat: 41.2, minLng: -4.6, maxLng: -3.0 },
          },
          {
            name: 'Melilla',
            path: 'europe/spain/melilla',
            bounds: { minLat: 35.3, maxLat: 35.4, minLng: -3.0, maxLng: -2.9 },
          },
          {
            name: 'Murcia',
            path: 'europe/spain/murcia',
            bounds: { minLat: 37.4, maxLat: 38.8, minLng: -2.2, maxLng: -0.7 },
          },
          {
            name: 'Navarra',
            path: 'europe/spain/navarra',
            bounds: { minLat: 41.9, maxLat: 43.3, minLng: -2.5, maxLng: -0.5 },
          },
          {
            name: 'País Vasco',
            path: 'europe/spain/pais-vasco',
            bounds: { minLat: 42.4, maxLat: 43.5, minLng: -3.5, maxLng: -1.8 },
          },
          {
            name: 'Valencia',
            path: 'europe/spain/valencia',
            bounds: { minLat: 37.8, maxLat: 40.8, minLng: -1.5, maxLng: 0.5 },
          },
        ],
      },
      {
        name: 'Sweden',
        path: 'europe/sweden',
        bounds: { minLat: 55.3, maxLat: 69.1, minLng: 11.1, maxLng: 24.2 },
      },
      {
        name: 'Switzerland',
        path: 'europe/switzerland',
        bounds: { minLat: 45.8, maxLat: 47.9, minLng: 5.9, maxLng: 10.5 },
      },
      {
        name: 'Turkey',
        path: 'europe/turkey',
        bounds: { minLat: 35.8, maxLat: 42.2, minLng: 26.0, maxLng: 44.8 },
      },
      {
        name: 'Ukraine',
        path: 'europe/ukraine',
        bounds: { minLat: 44.4, maxLat: 52.4, minLng: 22.1, maxLng: 40.2 },
      },
      {
        name: 'United Kingdom',
        path: 'europe/united-kingdom',
        bounds: { minLat: 49.9, maxLat: 60.9, minLng: -8.2, maxLng: 1.8 },
        children: [
          {
            name: 'Bermuda',
            path: 'europe/united-kingdom/bermuda',
            bounds: { minLat: 32.3, maxLat: 32.4, minLng: -64.9, maxLng: -64.6 },
          },
          {
            name: 'England',
            path: 'europe/united-kingdom/england',
            bounds: { minLat: 49.9, maxLat: 55.8, minLng: -5.7, maxLng: 1.8 },
          },
          {
            name: 'Falkland Islands',
            path: 'europe/united-kingdom/falkland-islands',
            bounds: { minLat: -53.2, maxLat: -51.0, minLng: -61.4, maxLng: -57.7 },
          },
          {
            name: 'Scotland',
            path: 'europe/united-kingdom/scotland',
            bounds: { minLat: 54.6, maxLat: 60.9, minLng: -7.7, maxLng: -0.7 },
          },
          {
            name: 'Wales',
            path: 'europe/united-kingdom/wales',
            bounds: { minLat: 51.3, maxLat: 53.4, minLng: -5.4, maxLng: -2.7 },
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NORTH AMERICA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'North America',
    path: 'north-america',
    children: [
      {
        name: 'Canada',
        path: 'north-america/canada',
        bounds: { minLat: 41.7, maxLat: 83.1, minLng: -141.0, maxLng: -52.6 },
        children: [
          {
            name: 'Alberta',
            path: 'north-america/canada/alberta',
            bounds: { minLat: 49.0, maxLat: 60.0, minLng: -120.0, maxLng: -110.0 },
          },
          {
            name: 'British Columbia',
            path: 'north-america/canada/british-columbia',
            bounds: { minLat: 48.3, maxLat: 60.0, minLng: -139.1, maxLng: -114.1 },
          },
          {
            name: 'Manitoba',
            path: 'north-america/canada/manitoba',
            bounds: { minLat: 49.0, maxLat: 60.0, minLng: -102.0, maxLng: -88.9 },
          },
          {
            name: 'New Brunswick',
            path: 'north-america/canada/new-brunswick',
            bounds: { minLat: 44.6, maxLat: 48.1, minLng: -69.0, maxLng: -63.8 },
          },
          {
            name: 'Newfoundland and Labrador',
            path: 'north-america/canada/newfoundland-and-labrador',
            bounds: { minLat: 46.6, maxLat: 60.4, minLng: -67.8, maxLng: -52.6 },
          },
          {
            name: 'Northwest Territories',
            path: 'north-america/canada/northwest-territories',
            bounds: { minLat: 60.0, maxLat: 78.8, minLng: -136.5, maxLng: -101.9 },
          },
          {
            name: 'Nova Scotia',
            path: 'north-america/canada/nova-scotia',
            bounds: { minLat: 43.4, maxLat: 47.0, minLng: -66.3, maxLng: -59.7 },
          },
          {
            name: 'Nunavut',
            path: 'north-america/canada/nunavut',
            bounds: { minLat: 60.0, maxLat: 83.1, minLng: -120.0, maxLng: -61.1 },
          },
          {
            name: 'Ontario',
            path: 'north-america/canada/ontario',
            bounds: { minLat: 41.7, maxLat: 56.9, minLng: -95.2, maxLng: -74.3 },
          },
          {
            name: 'Prince Edward Island',
            path: 'north-america/canada/prince-edward-island',
            bounds: { minLat: 45.9, maxLat: 47.1, minLng: -64.5, maxLng: -62.0 },
          },
          {
            name: 'Quebec',
            path: 'north-america/canada/quebec',
            bounds: { minLat: 44.9, maxLat: 62.6, minLng: -79.8, maxLng: -57.1 },
          },
          {
            name: 'Saskatchewan',
            path: 'north-america/canada/saskatchewan',
            bounds: { minLat: 49.0, maxLat: 60.0, minLng: -110.0, maxLng: -101.4 },
          },
          {
            name: 'Yukon',
            path: 'north-america/canada/yukon',
            bounds: { minLat: 60.0, maxLat: 69.7, minLng: -141.0, maxLng: -124.0 },
          },
        ],
      },
      {
        name: 'Greenland',
        path: 'north-america/greenland',
        bounds: { minLat: 59.8, maxLat: 83.7, minLng: -73.1, maxLng: -12.1 },
      },
      {
        name: 'Mexico',
        path: 'north-america/mexico',
        bounds: { minLat: 14.5, maxLat: 32.7, minLng: -117.1, maxLng: -86.7 },
      },
      {
        name: 'United States of America',
        path: 'north-america/us',
        bounds: { minLat: 17.9, maxLat: 71.4, minLng: -168.0, maxLng: -65.6 },
        children: [
          {
            name: 'Alabama',
            path: 'north-america/us/alabama',
            bounds: { minLat: 30.1, maxLat: 35.0, minLng: -88.5, maxLng: -84.9 },
          },
          {
            name: 'Alaska',
            path: 'north-america/us/alaska',
            bounds: { minLat: 51.2, maxLat: 71.4, minLng: -168.0, maxLng: -130.0 },
          },
          {
            name: 'Arizona',
            path: 'north-america/us/arizona',
            bounds: { minLat: 31.3, maxLat: 37.0, minLng: -114.8, maxLng: -109.0 },
          },
          {
            name: 'Arkansas',
            path: 'north-america/us/arkansas',
            bounds: { minLat: 33.0, maxLat: 36.5, minLng: -94.6, maxLng: -89.6 },
          },
          {
            name: 'California',
            path: 'north-america/us/california',
            bounds: { minLat: 32.5, maxLat: 42.0, minLng: -124.5, maxLng: -114.1 },
          },
          {
            name: 'Colorado',
            path: 'north-america/us/colorado',
            bounds: { minLat: 37.0, maxLat: 41.1, minLng: -109.1, maxLng: -102.0 },
          },
          {
            name: 'Connecticut',
            path: 'north-america/us/connecticut',
            bounds: { minLat: 40.9, maxLat: 42.1, minLng: -73.7, maxLng: -71.8 },
          },
          {
            name: 'Delaware',
            path: 'north-america/us/delaware',
            bounds: { minLat: 38.4, maxLat: 39.8, minLng: -75.8, maxLng: -75.0 },
          },
          {
            name: 'District of Columbia',
            path: 'north-america/us/district-of-columbia',
            bounds: { minLat: 38.8, maxLat: 39.0, minLng: -77.1, maxLng: -76.9 },
          },
          {
            name: 'Florida',
            path: 'north-america/us/florida',
            bounds: { minLat: 24.4, maxLat: 31.0, minLng: -87.6, maxLng: -80.0 },
          },
          {
            name: 'Georgia',
            path: 'north-america/us/georgia',
            bounds: { minLat: 30.4, maxLat: 35.0, minLng: -85.6, maxLng: -81.0 },
          },
          {
            name: 'Hawaii',
            path: 'north-america/us/hawaii',
            bounds: { minLat: 18.9, maxLat: 22.2, minLng: -160.3, maxLng: -154.8 },
          },
          {
            name: 'Idaho',
            path: 'north-america/us/idaho',
            bounds: { minLat: 41.9, maxLat: 49.0, minLng: -117.2, maxLng: -111.0 },
          },
          {
            name: 'Illinois',
            path: 'north-america/us/illinois',
            bounds: { minLat: 36.9, maxLat: 42.5, minLng: -91.5, maxLng: -87.0 },
          },
          {
            name: 'Indiana',
            path: 'north-america/us/indiana',
            bounds: { minLat: 37.8, maxLat: 41.8, minLng: -88.1, maxLng: -84.8 },
          },
          {
            name: 'Iowa',
            path: 'north-america/us/iowa',
            bounds: { minLat: 40.4, maxLat: 43.5, minLng: -96.6, maxLng: -90.1 },
          },
          {
            name: 'Kansas',
            path: 'north-america/us/kansas',
            bounds: { minLat: 36.9, maxLat: 40.1, minLng: -102.1, maxLng: -94.6 },
          },
          {
            name: 'Kentucky',
            path: 'north-america/us/kentucky',
            bounds: { minLat: 36.5, maxLat: 39.1, minLng: -89.6, maxLng: -82.0 },
          },
          {
            name: 'Louisiana',
            path: 'north-america/us/louisiana',
            bounds: { minLat: 28.9, maxLat: 33.0, minLng: -94.1, maxLng: -89.0 },
          },
          {
            name: 'Maine',
            path: 'north-america/us/maine',
            bounds: { minLat: 43.1, maxLat: 47.5, minLng: -71.1, maxLng: -67.0 },
          },
          {
            name: 'Maryland',
            path: 'north-america/us/maryland',
            bounds: { minLat: 37.9, maxLat: 39.7, minLng: -79.5, maxLng: -75.0 },
          },
          {
            name: 'Massachusetts',
            path: 'north-america/us/massachusetts',
            bounds: { minLat: 41.2, maxLat: 42.9, minLng: -73.5, maxLng: -69.9 },
          },
          {
            name: 'Michigan',
            path: 'north-america/us/michigan',
            bounds: { minLat: 41.7, maxLat: 47.5, minLng: -90.4, maxLng: -82.4 },
          },
          {
            name: 'Minnesota',
            path: 'north-america/us/minnesota',
            bounds: { minLat: 43.5, maxLat: 49.4, minLng: -97.2, maxLng: -89.5 },
          },
          {
            name: 'Mississippi',
            path: 'north-america/us/mississippi',
            bounds: { minLat: 30.2, maxLat: 35.0, minLng: -91.7, maxLng: -88.1 },
          },
          {
            name: 'Missouri',
            path: 'north-america/us/missouri',
            bounds: { minLat: 36.0, maxLat: 40.6, minLng: -95.8, maxLng: -89.1 },
          },
          {
            name: 'Montana',
            path: 'north-america/us/montana',
            bounds: { minLat: 44.4, maxLat: 49.0, minLng: -116.1, maxLng: -104.0 },
          },
          {
            name: 'Nebraska',
            path: 'north-america/us/nebraska',
            bounds: { minLat: 40.0, maxLat: 43.0, minLng: -104.1, maxLng: -95.3 },
          },
          {
            name: 'Nevada',
            path: 'north-america/us/nevada',
            bounds: { minLat: 35.0, maxLat: 42.0, minLng: -120.0, maxLng: -114.0 },
          },
          {
            name: 'New Hampshire',
            path: 'north-america/us/new-hampshire',
            bounds: { minLat: 42.7, maxLat: 45.3, minLng: -72.6, maxLng: -70.6 },
          },
          {
            name: 'New Jersey',
            path: 'north-america/us/new-jersey',
            bounds: { minLat: 38.9, maxLat: 41.4, minLng: -75.6, maxLng: -73.9 },
          },
          {
            name: 'New Mexico',
            path: 'north-america/us/new-mexico',
            bounds: { minLat: 31.3, maxLat: 37.0, minLng: -109.1, maxLng: -103.0 },
          },
          {
            name: 'New York',
            path: 'north-america/us/new-york',
            bounds: { minLat: 40.5, maxLat: 45.0, minLng: -79.8, maxLng: -71.8 },
          },
          {
            name: 'North Carolina',
            path: 'north-america/us/north-carolina',
            bounds: { minLat: 33.8, maxLat: 36.6, minLng: -84.3, maxLng: -75.5 },
          },
          {
            name: 'North Dakota',
            path: 'north-america/us/north-dakota',
            bounds: { minLat: 45.9, maxLat: 49.0, minLng: -104.1, maxLng: -96.6 },
          },
          {
            name: 'Ohio',
            path: 'north-america/us/ohio',
            bounds: { minLat: 38.4, maxLat: 42.3, minLng: -84.8, maxLng: -80.5 },
          },
          {
            name: 'Oklahoma',
            path: 'north-america/us/oklahoma',
            bounds: { minLat: 33.6, maxLat: 37.0, minLng: -103.0, maxLng: -94.4 },
          },
          {
            name: 'Oregon',
            path: 'north-america/us/oregon',
            bounds: { minLat: 42.0, maxLat: 46.3, minLng: -124.6, maxLng: -116.5 },
          },
          {
            name: 'Pennsylvania',
            path: 'north-america/us/pennsylvania',
            bounds: { minLat: 39.7, maxLat: 42.3, minLng: -80.5, maxLng: -74.7 },
          },
          {
            name: 'Puerto Rico',
            path: 'north-america/us/puerto-rico',
            bounds: { minLat: 17.9, maxLat: 18.5, minLng: -67.3, maxLng: -65.6 },
          },
          {
            name: 'Rhode Island',
            path: 'north-america/us/rhode-island',
            bounds: { minLat: 41.1, maxLat: 42.0, minLng: -71.9, maxLng: -71.1 },
          },
          {
            name: 'South Carolina',
            path: 'north-america/us/south-carolina',
            bounds: { minLat: 32.0, maxLat: 35.2, minLng: -83.4, maxLng: -78.5 },
          },
          {
            name: 'South Dakota',
            path: 'north-america/us/south-dakota',
            bounds: { minLat: 42.5, maxLat: 45.9, minLng: -104.1, maxLng: -96.4 },
          },
          {
            name: 'Tennessee',
            path: 'north-america/us/tennessee',
            bounds: { minLat: 35.0, maxLat: 36.7, minLng: -90.3, maxLng: -81.6 },
          },
          {
            name: 'Texas',
            path: 'north-america/us/texas',
            bounds: { minLat: 25.8, maxLat: 36.5, minLng: -106.6, maxLng: -93.5 },
          },
          {
            name: 'US Virgin Islands',
            path: 'north-america/us/us-virgin-islands',
            bounds: { minLat: 17.7, maxLat: 18.4, minLng: -65.1, maxLng: -64.6 },
          },
          {
            name: 'Utah',
            path: 'north-america/us/utah',
            bounds: { minLat: 36.9, maxLat: 42.0, minLng: -114.1, maxLng: -109.0 },
          },
          {
            name: 'Vermont',
            path: 'north-america/us/vermont',
            bounds: { minLat: 42.7, maxLat: 45.0, minLng: -73.4, maxLng: -71.5 },
          },
          {
            name: 'Virginia',
            path: 'north-america/us/virginia',
            bounds: { minLat: 36.5, maxLat: 39.5, minLng: -83.7, maxLng: -75.2 },
          },
          {
            name: 'Washington',
            path: 'north-america/us/washington',
            bounds: { minLat: 45.5, maxLat: 49.0, minLng: -124.7, maxLng: -116.9 },
          },
          {
            name: 'West Virginia',
            path: 'north-america/us/west-virginia',
            bounds: { minLat: 37.2, maxLat: 40.6, minLng: -82.6, maxLng: -77.7 },
          },
          {
            name: 'Wisconsin',
            path: 'north-america/us/wisconsin',
            bounds: { minLat: 42.5, maxLat: 47.1, minLng: -92.9, maxLng: -86.8 },
          },
          {
            name: 'Wyoming',
            path: 'north-america/us/wyoming',
            bounds: { minLat: 41.0, maxLat: 45.0, minLng: -111.1, maxLng: -104.1 },
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RUSSIAN FEDERATION (special: root-level on Geofabrik, not under a continent)
  // Also cross-listed under Europe above.
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Russian Federation',
    path: 'russia',
    bounds: { minLat: 41.0, maxLat: 81.9, minLng: 19.6, maxLng: 180.0 },
    children: [
      {
        name: 'Central Federal District',
        path: 'russia/central-fed-district',
        bounds: { minLat: 53.5, maxLat: 58.5, minLng: 32.0, maxLng: 41.0 },
      },
      {
        name: 'Crimean Federal District',
        path: 'russia/crimean-fed-district',
        bounds: { minLat: 44.4, maxLat: 46.2, minLng: 32.5, maxLng: 36.7 },
      },
      {
        name: 'Far Eastern Federal District',
        path: 'russia/far-eastern-fed-district',
        bounds: { minLat: 42.0, maxLat: 72.0, minLng: 131.0, maxLng: 180.0 },
      },
      {
        name: 'North Caucasus Federal District',
        path: 'russia/north-caucasus-fed-district',
        bounds: { minLat: 41.0, maxLat: 46.0, minLng: 40.0, maxLng: 48.0 },
      },
      {
        name: 'Northwestern Federal District',
        path: 'russia/northwestern-fed-district',
        bounds: { minLat: 58.0, maxLat: 70.0, minLng: 26.0, maxLng: 62.0 },
      },
      {
        name: 'Siberian Federal District',
        path: 'russia/siberian-fed-district',
        bounds: { minLat: 50.0, maxLat: 72.0, minLng: 60.0, maxLng: 111.0 },
      },
      {
        name: 'South Federal District',
        path: 'russia/south-fed-district',
        bounds: { minLat: 44.0, maxLat: 51.0, minLng: 36.0, maxLng: 50.0 },
      },
      {
        name: 'Ural Federal District',
        path: 'russia/ural-fed-district',
        bounds: { minLat: 54.5, maxLat: 70.0, minLng: 58.0, maxLng: 68.0 },
      },
      {
        name: 'Volga Federal District',
        path: 'russia/volga-fed-district',
        bounds: { minLat: 51.0, maxLat: 59.5, minLng: 44.0, maxLng: 57.0 },
      },
      {
        name: 'Kaliningrad',
        path: 'russia/kaliningrad',
        bounds: { minLat: 54.3, maxLat: 55.3, minLng: 19.6, maxLng: 22.9 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOUTH AMERICA
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'South America',
    path: 'south-america',
    children: [
      {
        name: 'Argentina',
        path: 'south-america/argentina',
        bounds: { minLat: -55.1, maxLat: -21.8, minLng: -73.6, maxLng: -53.6 },
      },
      {
        name: 'Bolivia',
        path: 'south-america/bolivia',
        bounds: { minLat: -22.9, maxLat: -9.7, minLng: -69.7, maxLng: -57.5 },
      },
      {
        name: 'Brazil',
        path: 'south-america/brazil',
        bounds: { minLat: -33.9, maxLat: 5.3, minLng: -73.9, maxLng: -34.8 },
      },
      {
        name: 'Chile',
        path: 'south-america/chile',
        bounds: { minLat: -55.9, maxLat: -17.5, minLng: -75.6, maxLng: -66.4 },
      },
      {
        name: 'Colombia',
        path: 'south-america/colombia',
        bounds: { minLat: -4.2, maxLat: 12.5, minLng: -79.0, maxLng: -66.9 },
      },
      {
        name: 'Ecuador',
        path: 'south-america/ecuador',
        bounds: { minLat: -5.0, maxLat: 1.5, minLng: -81.1, maxLng: -75.2 },
      },
      {
        name: 'Guyana',
        path: 'south-america/guyana',
        bounds: { minLat: 1.2, maxLat: 8.5, minLng: -61.4, maxLng: -57.2 },
      },
      {
        name: 'Paraguay',
        path: 'south-america/paraguay',
        bounds: { minLat: -27.6, maxLat: -19.3, minLng: -62.7, maxLng: -54.2 },
      },
      {
        name: 'Peru',
        path: 'south-america/peru',
        bounds: { minLat: -18.4, maxLat: -0.1, minLng: -81.4, maxLng: -68.7 },
      },
      {
        name: 'Suriname',
        path: 'south-america/suriname',
        bounds: { minLat: 1.8, maxLat: 6.0, minLng: -58.1, maxLng: -53.9 },
      },
      {
        name: 'Uruguay',
        path: 'south-america/uruguay',
        bounds: { minLat: -34.9, maxLat: -30.1, minLng: -58.5, maxLng: -53.1 },
      },
      {
        name: 'Venezuela',
        path: 'south-america/venezuela',
        bounds: { minLat: 0.7, maxLat: 12.2, minLng: -73.4, maxLng: -60.0 },
      },
    ],
  },
];
