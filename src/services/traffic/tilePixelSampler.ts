import { inflate as pakoInflate } from 'pako';
import type { NormalizedTrafficSegment } from '../../models/traffic';
import { tomtomApiKey, TOMTOM_FLOW_TILES_BASE_URL } from '../../constants/config';

// ── TomTom traffic tile color centroids ────────────────────────────
// Exact hex matching fails because TomTom renders anti-aliased road
// lines — pixel colors blend with the background.  Instead we classify
// each pixel by Euclidean distance to these reference centroids.

const TRAFFIC_CENTROIDS: Array<{ r: number; g: number; b: number; ratio: number; label: string }> =
  [
    { r: 100, g: 200, b: 40, ratio: 1.0, label: 'green' },
    { r: 230, g: 180, b: 40, ratio: 0.6, label: 'yellow' },
    { r: 220, g: 110, b: 35, ratio: 0.35, label: 'orange' },
    { r: 220, g: 70, b: 30, ratio: 0.1, label: 'red' },
  ];

/** Maximum squared Euclidean distance from a reference centroid to still consider it a match. */
const MAX_COLOR_DIST_SQ = 80 * 80; // ~80 units per channel

/** Classify a pixel's RGB by finding the nearest traffic color centroid. Returns -1 for no match. */
function rgbToRatio(r: number, g: number, b: number): number {
  let bestDistSq = Infinity;
  let bestRatio = -1;

  for (const c of TRAFFIC_CENTROIDS) {
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const dSq = dr * dr + dg * dg + db * db;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestRatio = c.ratio;
    }
  }

  if (bestDistSq > MAX_COLOR_DIST_SQ) return -1;
  return bestRatio;
}

// ── Web Mercator tile math ─────────────────────────────────────────

interface TilePoint {
  /** Tile x index */
  tx: number;
  /** Tile y index */
  ty: number;
  /** Pixel x within the 256×256 tile */
  px: number;
  /** Pixel y within the 256×256 tile */
  py: number;
  /** Original route coordinate index (for ordering) */
  coordIndex: number;
  /** Original lat/lng for the returned segment */
  lng: number;
  lat: number;
}

function lngLatToTile(lng: number, lat: number, zoom: number): TilePoint {
  const n = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  return {
    tx: Math.floor(x),
    ty: Math.floor(y),
    px: Math.floor((x - Math.floor(x)) * 256),
    py: Math.floor((y - Math.floor(y)) * 256),
    coordIndex: -1, // filled in later
    lng,
    lat,
  };
}

// ── PNG decoding (single-pixel reader) ─────────────────────────────

interface DecodedTile {
  width: number;
  height: number;
  /** RGBA pixel data, one Uint8Array of length width*height*4 */
  pixels: Uint8Array;
}

/**
 * Decode a PNG ArrayBuffer into raw RGBA pixels using pako for inflation.
 * Handles 8-bit RGB, RGBA, and palette-indexed PNGs.
 * TomTom tiles are 256×256 8-bit RGBA PNGs.
 */
function decodePng(buffer: ArrayBuffer): DecodedTile | null {
  const data = new Uint8Array(buffer);

  // PNG signature check
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== sig[i]) return null;
  }

  let width = 0;
  let height = 0;
  let colorType = 2; // default RGB
  const palette: [number, number, number][] = [];
  const idatChunks: Uint8Array[] = [];

  let pos = 8;
  while (pos < data.length - 4) {
    const length = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
    pos += 4;
    const type = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
    pos += 4;

    if (type === 'IHDR') {
      width = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
      height = (data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7];
      colorType = data[pos + 9];
    } else if (type === 'PLTE') {
      for (let i = 0; i < length; i += 3) {
        palette.push([data[pos + i], data[pos + i + 1], data[pos + i + 2]]);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data.slice(pos, pos + length));
    } else if (type === 'IEND') {
      break;
    }

    pos += length + 4; // skip data + CRC
  }

  if (width === 0 || height === 0 || idatChunks.length === 0) return null;

  // Concatenate and inflate IDAT chunks
  const totalIdat = idatChunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(totalIdat);
  let offset = 0;
  for (const chunk of idatChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const inflated = pakoInflate(merged);

  // Apply PNG filters and convert to RGBA
  const bytesPerPixel = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 3 ? 1 : 4;
  const stride = width * bytesPerPixel + 1; // +1 for filter byte per row
  const rgba = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row++) {
    const rowStart = row * stride;
    const filter = inflated[rowStart];
    const src = inflated.subarray(rowStart + 1, rowStart + stride);
    const prevRow =
      row > 0 ? inflated.subarray((row - 1) * stride + 1, (row - 1) * stride + stride) : null;

    // Unfilter
    const unfiltered = new Uint8Array(width * bytesPerPixel);
    for (let col = 0; col < width * bytesPerPixel; col++) {
      const a = col >= bytesPerPixel ? unfiltered[col - bytesPerPixel] : 0;
      const b = prevRow ? prevRow[col] : 0;
      const c = col >= bytesPerPixel && prevRow ? prevRow[col - bytesPerPixel] : 0;

      let val: number;
      switch (filter) {
        case 0: // None
          val = src[col];
          break;
        case 1: // Sub
          val = (src[col] + a) & 0xff;
          break;
        case 2: // Up
          val = (src[col] + b) & 0xff;
          break;
        case 3: // Average
          val = (src[col] + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: // Paeth
          {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            val = (src[col] + pr) & 0xff;
          }
          break;
        default:
          val = src[col];
      }
      unfiltered[col] = val;
    }

    // Convert to RGBA
    const rowRgba = row * width * 4;
    if (colorType === 3) {
      // Palette-indexed
      for (let col = 0; col < width; col++) {
        const idx = unfiltered[col];
        const rgb = palette[idx] ?? [0, 0, 0];
        rgba[rowRgba + col * 4] = rgb[0];
        rgba[rowRgba + col * 4 + 1] = rgb[1];
        rgba[rowRgba + col * 4 + 2] = rgb[2];
        rgba[rowRgba + col * 4 + 3] = 255;
      }
    } else if (colorType === 2) {
      // RGB
      for (let col = 0; col < width; col++) {
        rgba[rowRgba + col * 4] = unfiltered[col * 3];
        rgba[rowRgba + col * 4 + 1] = unfiltered[col * 3 + 1];
        rgba[rowRgba + col * 4 + 2] = unfiltered[col * 3 + 2];
        rgba[rowRgba + col * 4 + 3] = 255;
      }
    } else if (colorType === 6) {
      // RGBA
      for (let col = 0; col < width; col++) {
        rgba[rowRgba + col * 4] = unfiltered[col * 4];
        rgba[rowRgba + col * 4 + 1] = unfiltered[col * 4 + 1];
        rgba[rowRgba + col * 4 + 2] = unfiltered[col * 4 + 2];
        rgba[rowRgba + col * 4 + 3] = unfiltered[col * 4 + 3];
      }
    }
  }

  return { width, height, pixels: rgba };
}

/**
 * Read a single pixel's RGBA from a decoded tile at the given coordinates.
 */
function readPixel(tile: DecodedTile, px: number, py: number): [number, number, number, number] {
  const idx = (py * tile.width + px) * 4;
  return [tile.pixels[idx], tile.pixels[idx + 1], tile.pixels[idx + 2], tile.pixels[idx + 3]];
}

// ── Tile fetching with caching ─────────────────────────────────────

/** In-memory cache of decoded tiles keyed by "z/x/y". */
const tileCache = new Map<string, DecodedTile>();

async function fetchAndDecodeTile(z: number, x: number, y: number): Promise<DecodedTile | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  const url = `${TOMTOM_FLOW_TILES_BASE_URL}/${z}/${x}/${y}.png?key=${encodeURIComponent(tomtomApiKey)}&tileSize=256&thickness=3`;
  const redactedUrl = url.replace(/key=[^&]+/, 'key=REDACTED');

  try {
    if (__DEV__) console.log(`[TileSampler] fetching tile ${key}: ${redactedUrl}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[TileSampler] tile ${key} HTTP ${res.status} for ${redactedUrl}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    if (__DEV__) console.log(`[TileSampler] tile ${key} fetched ${buffer.byteLength} bytes`);
    let decoded: DecodedTile | null = null;
    try {
      decoded = decodePng(buffer);
    } catch (err) {
      console.warn(`[TileSampler] tile ${key} PNG decode threw:`, err);
      return null;
    }
    if (!decoded) {
      console.warn(
        `[TileSampler] tile ${key} PNG decode returned null (${buffer.byteLength} bytes)`,
      );
      return null;
    }
    if (__DEV__)
      console.log(`[TileSampler] tile ${key} decoded ${decoded.width}x${decoded.height}`);
    tileCache.set(key, decoded);
    return decoded;
  } catch (err) {
    console.warn(`[TileSampler] tile ${key} fetch error:`, err);
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Sample traffic flow colors from TomTom raster tiles at points along a
 * route polyline. Returns normalized traffic segments that the route-
 * matching algorithm can use to color-code the route line.
 *
 * This replaces the point-by-point Flow Segment Data API approach.
 * Instead of 80+ API calls for a long route, this downloads ~5–10 tile
 * images that MapLibre already has in its HTTP cache.
 */
export async function sampleRouteTileColors(
  routeCoords: [number, number][],
): Promise<NormalizedTrafficSegment[]> {
  if (!tomtomApiKey) {
    console.warn('[TileSampler] No TomTom API key configured. Traffic route colors unavailable.');
    return [];
  }

  // Sample roughly every 500 m along the route (same as old ROUTE_SAMPLE_SPACING_DEG)
  const sampleSpacingDeg = 0.005;
  const sampled: Array<{ lng: number; lat: number; coordIndex: number }> = [];
  if (routeCoords.length > 0) {
    sampled.push({ lng: routeCoords[0][0], lat: routeCoords[0][1], coordIndex: 0 });
    let lastLng = routeCoords[0][0];
    let lastLat = routeCoords[0][1];
    for (let i = 1; i < routeCoords.length; i++) {
      const dlng = routeCoords[i][0] - lastLng;
      const dlat = routeCoords[i][1] - lastLat;
      if (dlng * dlng + dlat * dlat >= sampleSpacingDeg * sampleSpacingDeg) {
        sampled.push({ lng: routeCoords[i][0], lat: routeCoords[i][1], coordIndex: i });
        lastLng = routeCoords[i][0];
        lastLat = routeCoords[i][1];
      }
    }
    const last = routeCoords[routeCoords.length - 1];
    if (last[0] !== lastLng || last[1] !== lastLat) {
      sampled.push({ lng: last[0], lat: last[1], coordIndex: routeCoords.length - 1 });
    }
  }

  // Convert to tile+px,py. Use zoom 14 for a good balance of detail vs tile count.
  const zoom = 14;
  const tilePoints: TilePoint[] = sampled.map((pt) => {
    const tp = lngLatToTile(pt.lng, pt.lat, zoom);
    tp.coordIndex = pt.coordIndex;
    return tp;
  });

  // Group by tile
  const byTile = new Map<string, TilePoint[]>();
  for (const tp of tilePoints) {
    const key = `${tp.tx}/${tp.ty}`;
    const group = byTile.get(key);
    if (group) {
      group.push(tp);
    } else {
      byTile.set(key, [tp]);
    }
  }

  // Fetch and decode each unique tile, then sample pixels
  const segments: NormalizedTrafficSegment[] = [];
  const seenIds = new Set<string>();

  const tilePromises = Array.from(byTile.entries()).map(async ([key, points]) => {
    const [tx, ty] = key.split('/').map(Number);
    const tile = await fetchAndDecodeTile(zoom, tx, ty);
    if (!tile) return;

    for (const pt of points) {
      const [r, g, b, a] = readPixel(tile, pt.px, pt.py);
      if (a < 128) continue; // transparent / no data
      const ratio = rgbToRatio(r, g, b);
      if (ratio < 0) continue;

      // Build a synthetic segment for this point
      const id = `tile:${tx}/${ty}/${pt.px}/${pt.py}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      segments.push({
        id,
        coordinates: [[pt.lng, pt.lat]],
        currentSpeedMph: 0, // derived from ratio × route free-flow in ETA calc
        freeFlowSpeedMph: 0, // unknown — use route segment's own free-flow speed
        congestionRatio: ratio,
        confidence: 0.8,
        source: 'tomtom',
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
  });

  await Promise.all(tilePromises);

  if (__DEV__) {
    const ratios = segments.map((s) => s.congestionRatio.toFixed(2));
    console.log(
      `[TileSampler] ${routeCoords.length} route coords → ${sampled.length} sampled points → ${byTile.size} tiles → ${segments.length} colored segments; ratios: ${ratios.slice(0, 20).join(', ')}`,
    );
  }

  return segments;
}
