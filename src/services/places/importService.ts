import type { PlaceList, SavedPlace } from '../../models/placeList';

/**
 * Parsers for importing place lists from various formats exported by
 * Google Maps Takeout, Google My Maps, and third-party converters.
 *
 * Supported: CSV, JSON (Takeout), GeoJSON, KML/KMZ, GPX.
 */

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// CSV (Google Takeout lists export)
// ---------------------------------------------------------------------------

/** Parse a Google Takeout CSV list. Format: Title,Note,URL,Comment */
export function parseCSV(csvText: string, listName?: string): PlaceList {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('Empty CSV file');

  // Detect header row
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('title') || header.includes('name') || header.includes('url');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const places: SavedPlace[] = dataLines.map((line) => {
    const fields = parseCSVLine(line);
    // Google Takeout: Title, Note, URL, Comment
    // Some exports: Name, Address, URL, Note, Latitude, Longitude
    const name = fields[0] ?? 'Unknown Place';
    const note = fields[1] || fields[3] || undefined;
    const url = fields[2] || undefined;
    // Try to extract lat/lng from URL or later fields
    const coords = extractCoordsFromUrl(url) ?? extractCoordsFromFields(fields);

    return {
      id: generateId(),
      name: name.trim(),
      note: note?.trim(),
      lat: coords?.lat ?? 0,
      lng: coords?.lng ?? 0,
      googleMapsUrl: url?.trim(),
      addedAt: Date.now(),
    };
  });

  const now = Date.now();
  return {
    id: generateId(),
    name: listName ?? 'Imported List',
    isPrivate: true,
    places,
    createdAt: now,
    updatedAt: now,
  };
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function extractCoordsFromUrl(url?: string): { lat: number; lng: number } | null {
  if (!url) return null;
  // Google Maps URLs: .../@40.7128,-74.006,... or ...?q=40.7128,-74.006
  const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }
  const qMatch = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (qMatch) {
    return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
  }
  return null;
}

function extractCoordsFromFields(fields: string[]): { lat: number; lng: number } | null {
  // Look for numeric fields that could be lat/lng
  for (let i = 0; i < fields.length - 1; i++) {
    const a = parseFloat(fields[i]);
    const b = parseFloat(fields[i + 1]);
    if (!isNaN(a) && !isNaN(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180) {
      return { lat: a, lng: b };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON (Google Takeout structured export)
// ---------------------------------------------------------------------------

interface TakeoutFeature {
  geometry?: { location?: { lat?: number; lng?: number } };
  properties?: {
    name?: string;
    'Google Maps URL'?: string;
    address?: string;
    Location?: { 'Geo Coordinates'?: { Latitude?: number; Longitude?: number } };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function parseJSON(jsonText: string, listName?: string): PlaceList {
  const data = JSON.parse(jsonText);

  // Handle different JSON structures from Google Takeout
  let features: TakeoutFeature[] = [];
  if (Array.isArray(data)) {
    features = data;
  } else if (data.features && Array.isArray(data.features)) {
    // GeoJSON-like
    return parseGeoJSON(jsonText, listName);
  } else if (data.type === 'FeatureCollection') {
    return parseGeoJSON(jsonText, listName);
  }

  const places: SavedPlace[] = features.map((f: TakeoutFeature) => {
    const props = f.properties ?? (f as Record<string, unknown>);
    const name = (props.name as string) ?? 'Unknown Place';
    const url = props['Google Maps URL'] as string | undefined;
    const address = props.address as string | undefined;

    let lat = 0;
    let lng = 0;
    if (f.geometry?.location) {
      lat = f.geometry.location.lat ?? 0;
      lng = f.geometry.location.lng ?? 0;
    }
    const locData = props['Location'] as
      | { 'Geo Coordinates'?: { Latitude?: number; Longitude?: number } }
      | undefined;
    if (locData?.['Geo Coordinates']) {
      lat = locData['Geo Coordinates'].Latitude ?? lat;
      lng = locData['Geo Coordinates'].Longitude ?? lng;
    }
    if (lat === 0 && lng === 0 && url) {
      const coords = extractCoordsFromUrl(url);
      if (coords) {
        lat = coords.lat;
        lng = coords.lng;
      }
    }

    return {
      id: generateId(),
      name,
      lat,
      lng,
      address,
      googleMapsUrl: url,
      addedAt: Date.now(),
    };
  });

  const now = Date.now();
  return {
    id: generateId(),
    name: listName ?? 'Imported List',
    isPrivate: true,
    places,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

interface GeoJSONFeature {
  type: 'Feature';
  geometry?: {
    type: string;
    coordinates?: number[];
  };
  properties?: Record<string, unknown>;
}

export function parseGeoJSON(jsonText: string, listName?: string): PlaceList {
  const data = JSON.parse(jsonText);
  const features: GeoJSONFeature[] = data.features ?? [];

  const places: SavedPlace[] = features
    .filter((f) => f.geometry?.type === 'Point' && f.geometry?.coordinates)
    .map((f) => {
      const [lng, lat] = f.geometry!.coordinates!;
      const props = f.properties ?? {};
      const name =
        (props.name as string) ??
        (props.title as string) ??
        (props.Name as string) ??
        'Unknown Place';
      const address = (props.address as string) ?? (props.Address as string) ?? undefined;
      const note = (props.description as string) ?? (props.note as string) ?? undefined;
      const category = (props.category as string) ?? undefined;

      return {
        id: generateId(),
        name,
        note,
        lat,
        lng,
        address,
        category,
        addedAt: Date.now(),
      };
    });

  const now = Date.now();
  return {
    id: generateId(),
    name: listName ?? data.name ?? 'Imported List',
    isPrivate: true,
    places,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// KML (Google My Maps export)
// ---------------------------------------------------------------------------

export function parseKML(kmlText: string, listName?: string): PlaceList {
  const places: SavedPlace[] = [];

  // Extract Document name
  const docNameMatch = kmlText.match(/<Document>\s*<name>([^<]*)<\/name>/);
  const docName = docNameMatch?.[1] ?? listName ?? 'Imported List';

  // Extract all Placemarks
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/gi;
  let match: RegExpExecArray | null;
  while ((match = placemarkRegex.exec(kmlText)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<name>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/name>/);
    const descMatch = block.match(
      /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/,
    );
    const coordMatch = block.match(
      /<coordinates>\s*(-?\d+\.?\d*),(-?\d+\.?\d*)(?:,(-?\d+\.?\d*))?\s*<\/coordinates>/,
    );

    if (coordMatch) {
      const lng = parseFloat(coordMatch[1]);
      const lat = parseFloat(coordMatch[2]);
      const name = nameMatch?.[1]?.trim() ?? 'Unknown Place';
      const note = descMatch?.[1]?.trim() || undefined;

      // Extract address from ExtendedData if present
      const addressMatch = block.match(/<Data name="address">\s*<value>([^<]*)<\/value>/);

      places.push({
        id: generateId(),
        name,
        note,
        lat,
        lng,
        address: addressMatch?.[1]?.trim(),
        addedAt: Date.now(),
      });
    }
  }

  const now = Date.now();
  return {
    id: generateId(),
    name: docName,
    isPrivate: true,
    places,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

export function parseGPX(gpxText: string, listName?: string): PlaceList {
  const places: SavedPlace[] = [];

  // Extract track/route name
  const metaNameMatch = gpxText.match(/<metadata>\s*<name>([^<]*)<\/name>/);
  const docName = metaNameMatch?.[1] ?? listName ?? 'Imported List';

  // Extract waypoints: <wpt lat="..." lon="...">
  const wptRegex = /<wpt\s+lat="(-?\d+\.?\d*)"\s+lon="(-?\d+\.?\d*)"[^>]*>([\s\S]*?)<\/wpt>/gi;
  let match: RegExpExecArray | null;
  while ((match = wptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    const block = match[3];

    const nameMatch = block.match(/<name>([^<]*)<\/name>/);
    const descMatch = block.match(/<desc>([^<]*)<\/desc>/);
    const linkMatch = block.match(/<link\s+href="([^"]*)">/);

    places.push({
      id: generateId(),
      name: nameMatch?.[1]?.trim() ?? 'Waypoint',
      note: descMatch?.[1]?.trim() || undefined,
      lat,
      lng,
      website: linkMatch?.[1]?.trim(),
      addedAt: Date.now(),
    });
  }

  const now = Date.now();
  return {
    id: generateId(),
    name: docName,
    isPrivate: true,
    places,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Auto-detect format and parse
// ---------------------------------------------------------------------------

export type ImportFormat = 'csv' | 'json' | 'geojson' | 'kml' | 'gpx';

export function detectFormat(content: string, filename?: string): ImportFormat {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'kml' || ext === 'kmz') return 'kml';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'geojson') return 'geojson';
  if (ext === 'json') {
    try {
      const data = JSON.parse(content);
      if (data.type === 'FeatureCollection' || data.features) return 'geojson';
    } catch {
      // not valid JSON
    }
    return 'json';
  }

  // Detect by content
  const trimmed = content.trimStart();
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<kml')) return 'kml';
  if (trimmed.startsWith('<gpx')) return 'gpx';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(content);
      if (data.type === 'FeatureCollection' || data.features) return 'geojson';
      return 'json';
    } catch {
      // fall through
    }
  }
  return 'csv';
}

export function parseImport(content: string, listName?: string, filename?: string): PlaceList {
  // Derive list name from filename if not explicitly provided
  const derivedName =
    listName ??
    (filename
      ? filename
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]/g, ' ')
          .trim()
      : undefined);
  const format = detectFormat(content, filename);
  switch (format) {
    case 'csv':
      return parseCSV(content, derivedName);
    case 'json':
      return parseJSON(content, derivedName);
    case 'geojson':
      return parseGeoJSON(content, derivedName);
    case 'kml':
      return parseKML(content, derivedName);
    case 'gpx':
      return parseGPX(content, derivedName);
  }
}
