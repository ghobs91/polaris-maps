#!/usr/bin/env node
/**
 * Discover and verify US state orthoimagery services for the satellite style.
 *
 * Why: at z17+ the only nationwide layer is the USGS NAIP ImageServer, which
 * renders each novel tile on demand (measured 20–90 s, with 502/504 under
 * load). While it renders, the map shows the z16 cache overzoomed at 2.4 m/px —
 * the "blurry squares". State ortho programs answer in a fraction of a second,
 * so they take over inside their bounds. This script finds them.
 *
 * Method (nothing is invented — every URL is discovered, then probed):
 *   1. Sweep the public ArcGIS Online item index for imagery services. This is
 *      how on-premise state servers (`gis.maine.gov`, `services.nconemap.gov`,
 *      …) are found: their items are registered in AGOL even when the tiles are
 *      served from the state's own ArcGIS Server.
 *   2. Read each service's own metadata (`?f=json`) for its extent, capability,
 *      native pixel size and copyright text.
 *   3. Map each service extent onto states, so a single statewide mosaic is not
 *      needed per candidate URL.
 *   4. Fetch real 256 px tiles from three points spread across the extent, in
 *      EPSG:3857 (what MapLibre's `{bbox-epsg-3857}` asks for), twice each, and
 *      keep the fastest response. Blank tiles are detected by size: a uniform
 *      256 px png32 compresses to under 1.5 kB, real imagery is tens of kB.
 *   5. Keep the newest state-scale source per state that answered in
 *      `MAX_SECONDS`.
 *
 * Usage:
 *   node scripts/probe-state-orthos.mjs                  # all states, JSON to stdout
 *   node scripts/probe-state-orthos.mjs CA TX FL         # a subset
 *   node scripts/probe-state-orthos.mjs --json out.json  # write the report
 *
 * The report is the evidence for every entry added to
 * `src/constants/orthophotoSources.ts`; rerun it before editing that registry.
 */

import { readFile, writeFile } from 'node:fs/promises';

const AGOL = 'https://www.arcgis.com/sharing/rest/search';
const MAX_SECONDS = 3;
const MIN_BYTES = 4000; // 256 px png32 of uniform no-data compresses to <1.5 kB
const TILE_PX = 256;
const FETCH_CONCURRENCY = 16;
const PROBE_CONCURRENCY = 6;

/** Approximate state boxes [w, s, e, n] — used only to attribute a service. */
const STATE_BOXES = [
  ['Alabama', 'AL', -88.5, 30.2, -84.9, 35.0],
  ['Alaska', 'AK', -170.0, 54.0, -130.0, 71.5],
  ['Arizona', 'AZ', -114.8, 31.3, -109.0, 37.0],
  ['Arkansas', 'AR', -94.6, 33.0, -89.6, 36.5],
  ['California', 'CA', -124.4, 32.5, -114.1, 42.0],
  ['Colorado', 'CO', -109.1, 37.0, -102.0, 41.0],
  ['Connecticut', 'CT', -73.7, 41.0, -71.8, 42.1],
  ['Delaware', 'DE', -75.8, 38.4, -75.0, 39.9],
  ['District of Columbia', 'DC', -77.12, 38.79, -76.91, 38.99],
  ['Florida', 'FL', -87.6, 24.5, -80.0, 31.0],
  ['Georgia', 'GA', -85.6, 30.4, -80.8, 35.0],
  ['Hawaii', 'HI', -160.3, 18.9, -154.8, 22.3],
  ['Idaho', 'ID', -117.2, 42.0, -111.0, 49.0],
  ['Illinois', 'IL', -91.5, 37.0, -87.5, 42.5],
  ['Indiana', 'IN', -88.1, 37.8, -84.8, 41.8],
  ['Iowa', 'IA', -96.6, 40.4, -90.1, 43.5],
  ['Kansas', 'KS', -102.1, 37.0, -94.6, 40.0],
  ['Kentucky', 'KY', -89.6, 36.5, -81.9, 39.2],
  ['Louisiana', 'LA', -94.1, 28.9, -88.8, 33.0],
  ['Maine', 'ME', -71.1, 43.0, -66.9, 47.5],
  ['Maryland', 'MD', -79.5, 37.9, -75.0, 39.7],
  ['Massachusetts', 'MA', -73.5, 41.2, -69.9, 42.9],
  ['Michigan', 'MI', -90.5, 41.7, -82.4, 48.3],
  ['Minnesota', 'MN', -97.2, 43.5, -89.5, 49.4],
  ['Mississippi', 'MS', -91.7, 30.2, -88.1, 35.0],
  ['Missouri', 'MO', -95.8, 36.0, -89.1, 40.6],
  ['Montana', 'MT', -116.1, 44.4, -104.0, 49.0],
  ['Nebraska', 'NE', -104.1, 40.0, -95.3, 43.0],
  ['Nevada', 'NV', -120.0, 35.0, -114.0, 42.0],
  ['New Hampshire', 'NH', -72.6, 42.7, -70.6, 45.3],
  ['New Jersey', 'NJ', -75.6, 38.9, -73.9, 41.4],
  ['New Mexico', 'NM', -109.1, 31.3, -103.0, 37.0],
  ['New York', 'NY', -79.8, 40.5, -71.9, 45.0],
  ['North Carolina', 'NC', -84.3, 33.8, -75.5, 36.6],
  ['North Dakota', 'ND', -104.1, 45.9, -96.6, 49.0],
  ['Ohio', 'OH', -84.8, 38.4, -80.5, 42.0],
  ['Oklahoma', 'OK', -103.0, 33.6, -94.4, 37.0],
  ['Oregon', 'OR', -124.6, 42.0, -116.5, 46.3],
  ['Pennsylvania', 'PA', -80.5, 39.7, -74.7, 42.3],
  ['Rhode Island', 'RI', -71.9, 41.1, -71.1, 42.0],
  ['South Carolina', 'SC', -83.4, 32.0, -78.5, 35.2],
  ['South Dakota', 'SD', -104.1, 42.5, -96.4, 45.9],
  ['Tennessee', 'TN', -90.3, 35.0, -81.6, 36.7],
  ['Texas', 'TX', -106.7, 25.8, -93.5, 36.5],
  ['Utah', 'UT', -114.1, 37.0, -109.0, 42.0],
  ['Vermont', 'VT', -73.4, 42.7, -71.5, 45.0],
  ['Virginia', 'VA', -83.7, 36.5, -75.2, 39.5],
  ['Washington', 'WA', -124.8, 45.5, -116.9, 49.0],
  ['West Virginia', 'WV', -82.6, 37.2, -77.7, 40.6],
  ['Wisconsin', 'WI', -92.9, 42.5, -86.8, 47.1],
  ['Wyoming', 'WY', -111.1, 41.0, -104.0, 45.0],
];

const IMAGERY_WORDS = /imagery|ortho|aerial|photogrammetr|pictometry|stratmap|naip/i;
const NOT_IMAGERY =
  /land ?cover|nlcd|wetland|radar|inundation|lidar|elevation|hydrograph|soils|parcel|census|boundar|contour|geo-?chem|slope|canopy|heat|noaa|nowcoast|fire|weather|transit|bus|route|address|ownership|zoning|cadastral|tax|disaster|nitrogen|tempo|no2|occurrence|draft|drought|snow|flood|smoke|hazard/i;

/** A service covering more states than this is a national mosaic, not a state source. */
const MAX_STATES_PER_SOURCE = 4;

// ── tiny fetch helpers ─────────────────────────────────────────────────────

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return { error: `http ${res.status}` };
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: 'not json' };
    }
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timeout' : String(err.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      bytes: buf.length,
      ms: Math.round(performance.now() - started),
      contentType: res.headers.get('content-type') ?? '',
    };
  } catch (err) {
    return {
      status: 0,
      bytes: 0,
      ms: Math.round(performance.now() - started),
      error: err.name === 'AbortError' ? 'timeout' : String(err.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i], i);
        } catch (err) {
          out[i] = { error: `threw: ${String(err.message ?? err)}`, item: items[i] };
        }
      }
    }),
  );
  return out;
}

// ── geometry ───────────────────────────────────────────────────────────────

const isGeographicSr = (sr) => {
  const wkid = sr?.latestWkid ?? sr?.wkid;
  return wkid === 4326 || (wkid >= 4000 && wkid < 5000 && wkid !== 3857);
};

/** Any supported service extent → [w, s, e, n] in degrees. */
function extentToDegrees(extent) {
  if (!extent) return null;
  const { xmin, ymin, xmax, ymax } = extent;
  if (![xmin, ymin, xmax, ymax].every((v) => typeof v === 'number')) return null;
  if (isGeographicSr(extent.spatialReference)) return [xmin, ymin, xmax, ymax];
  const R = 6378137;
  const lon = (v) => (v * 180) / (Math.PI * R);
  const lat = (v) => (2 * Math.atan(Math.exp(v / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon(xmin), lat(ymin), lon(xmax), lat(ymax)];
}

const toMercator = (lon, lat) => {
  const R = 6378137;
  return {
    x: (lon * Math.PI * R) / 180,
    y: Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R,
  };
};

const zoomResolution = (zoom, lat) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

const nativeZoom = (resolutionM, lat) => {
  if (!resolutionM || resolutionM <= 0) return 17;
  return Math.floor(Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / resolutionM));
};

const samplePoint = ([w, s, e, n], fx, fy) => [w + (e - w) * fx, s + (n - s) * fy];

function mercatorTileUrl(base, lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      n,
  );
  return `${base}/tile/${zoom}/${y}/${x}`;
}

function mercatorExportUrl(base, lon, lat, spanM = 220) {
  const { x, y } = toMercator(lon, lat);
  const bbox = [x - spanM, y - spanM, x + spanM, y + spanM].map((v) => v.toFixed(1)).join(',');
  return (
    `${base}/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${TILE_PX},${TILE_PX}` +
    '&format=png32&transparent=true&f=image'
  );
}

/**
 * Request URLs to try for one point, best first. Cached services are polled at
 * their tile endpoint; when that is not published (some Virginia caches 404 on
 * `/tile`) the dynamic render is the fallback.
 */
function requestUrlsFor(described, lon, lat) {
  const urls = [];
  const maxLevel = described.cacheLevels?.length ? Math.max(...described.cacheLevels) : 0;
  if (described.cached && maxLevel > 0) {
    // z18 is the level the app actually needs sharp (≈0.45 m/px at US latitudes);
    // verifying a z17 tile would not prove the level above it exists.
    urls.push(mercatorTileUrl(described.url, lon, lat, Math.min(maxLevel, 18)));
  }
  urls.push(
    /ImageServer$/i.test(described.url)
      ? mercatorExportUrl(`${described.url}/exportImage`, lon, lat)
      : mercatorExportUrl(described.url, lon, lat),
  );
  return urls;
}

/** The tile the contact sheet uses — the first URL that returns real pixels. */
async function sampleTile(described, fx = 0.5, fy = 0.5) {
  const [lon, lat] = samplePoint(described.bounds, fx, fy);
  for (const url of requestUrlsFor(described, lon, lat)) {
    const attempt = await fetchImage(url);
    if (attempt.status === 200 && attempt.buf.length >= MIN_BYTES) return attempt;
  }
  return { status: 0, buf: Buffer.alloc(0) };
}

async function fetchImage(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { status: 0, buf: Buffer.alloc(0) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attribute a service extent to states.
 *
 * "Covers ≥55 % of the state's box" over-claims badly: a Massachusetts mosaic
 * whose bounding box pokes into Connecticut, or the NYS mosaics whose box
 * reaches into Vermont, were credited to those neighbours. A service belongs to
 * a state when the *service* is mostly inside it, so the discriminator is
 * `share` (fraction of the service extent inside the state) plus a lower bound
 * on `coverage` (fraction of the state covered).
 */
function statesInExtent(extent) {
  const [w, s, e, n] = extent;
  const serviceArea = Math.max(1e-9, (e - w) * (n - s));
  const hits = [];
  for (const [state, abbr, bw, bs, be, bn] of STATE_BOXES) {
    const iw = Math.max(w, bw);
    const ie = Math.min(e, be);
    const is = Math.max(s, bs);
    const inn = Math.min(n, bn);
    if (ie <= iw || inn <= is) continue;
    const overlap = (ie - iw) * (inn - is);
    const share = overlap / serviceArea;
    const coverage = overlap / ((be - bw) * (bn - bs));
    if (share >= 0.55 && coverage >= 0.3) {
      hits.push({
        state,
        abbr,
        share: Number(share.toFixed(2)),
        coverage: Number(coverage.toFixed(2)),
      });
    }
  }
  return hits;
}

const STATE_ALIASES = { NY: ['New York', 'NYS'] };
const STATE_PATTERNS = STATE_BOXES.flatMap(([state, abbr]) =>
  [state, ...(STATE_ALIASES[abbr] ?? [])].map((needle) => ({
    abbr,
    re: new RegExp(`\\b${needle}\\b`, 'i'),
  })),
);

/** States named in a service's title or URL — a much stronger signal than extent. */
function namedStates(text) {
  return [...new Set(STATE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.abbr))];
}

/** True-colour only: CIR/NIR/NDVI/panchromatic mosaics render as false-colour rubbish. */
const NOT_TRUE_COLOR = /(^|[^a-z0-9])(cir|nir|ndvi|infrared|panchromatic|pan)([^a-z0-9]|$)/i;
const MIN_YEAR = 2018;
const MAX_RESOLUTION_M = 1.0;

// ── discovery ──────────────────────────────────────────────────────────────

/**
 * Sweep the AGOL item index. `total` is capped at 10 000 per query, so several
 * variants (and both services types) are needed to reach the state servers
 * that keyword search alone would miss.
 */
async function sweep() {
  const queries = [
    'type:"Image Service" AND (orthoimagery OR orthophoto OR orthoimagery OR imagery)',
    'type:"Map Service" AND (orthoimagery OR orthophoto) AND imagery',
    'type:"Image Service" AND tags:orthoimagery',
    'type:"Image Service" AND (aerial OR pictometry) AND imagery',
    'type:"Map Server" AND (orthophoto OR orthoimagery)',
    // State programmes usually advertise the ground sample distance in the
    // title, and that catches mosaics whose titles avoid "ortho".
    'type:"Image Service" AND ("6 inch" OR "9 inch" OR "3 inch" OR "1 foot" OR "12 inch") AND (imagery OR ortho)',
    'type:"Map Service" AND (statewide) AND (imagery OR aerial)',
  ];
  const seen = new Map();
  for (const q of queries) {
    for (let start = 1; start <= 2000; start += 100) {
      const url = `${AGOL}?f=json&num=100&start=${start}&q=${encodeURIComponent(q)}`;
      const json = await fetchJson(url);
      const results = json?.results ?? [];
      if (results.length === 0) break;
      for (const item of results) {
        const serviceUrl = item.url;
        if (!serviceUrl || typeof serviceUrl !== 'string') continue;
        // Layer-level item URLs (`/MapServer/12`) point at the same service.
        const serviceUrlNoLayer = serviceUrl.replace(/\/\d+$/, '');
        if (!/\/rest\/services\/.+\/(ImageServer|MapServer)$/.test(serviceUrlNoLayer)) {
          continue;
        }
        const haystack = `${item.title ?? ''} ${(item.tags ?? []).join(' ')} ${serviceUrl}`;
        if (!IMAGERY_WORDS.test(haystack) || NOT_IMAGERY.test(haystack)) continue;
        const clean = serviceUrl.replace(/\/$/, '');
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          title: item.title ?? '',
          url: clean,
          owner: item.owner ?? '',
          created: Number(item.created ?? 0),
          serviceType: item.type ?? '',
        });
      }
      await new Promise((r) => setTimeout(r, 120));
      if (start + 100 > (json?.total ?? 0)) break;
    }
    process.stderr.write(`   sweep "${q.slice(0, 46)}" → ${seen.size} candidates\n`);
  }
  return [...seen.values()];
}

/** Read one service's own metadata. */
async function describe(candidate) {
  const base = candidate.url.replace(/\/$/, '');
  const meta = await fetchJson(`${base}?f=json`, candidate.metaTimeoutMs ?? 20000);
  const metaError = meta?.error?.message ?? meta?.error;
  if (metaError) return { ...candidate, rejected: `metadata: ${String(metaError).slice(0, 90)}` };

  const extent = extentToDegrees(
    meta.fullExtent ?? meta.extent ?? meta.initialExtent ?? meta.extentOfFullCoverage,
  );
  if (!extent) return { ...candidate, rejected: 'no extent' };
  const [w, s, e, n] = extent;
  const spanLon = e - w;
  const spanLat = n - s;
  if (e < -180 || w > -60 || n < 17 || s > 72) return { ...candidate, rejected: 'outside CONUS' };

  const isImage = /ImageServer$/i.test(base);
  let resolutionM = null;
  let cacheLevels = [];
  if (isImage) {
    const px = meta.pixelSizeX ?? meta.pixelSizeY;
    if (typeof px === 'number' && px > 0) {
      resolutionM = isGeographicSr(meta.spatialReference ?? meta.fullExtent?.spatialReference)
        ? px * 111320
        : px;
    }
  }
  // A cache can sit behind an ImageServer too (NC, and anything published with
  // `singleFusedMapCache`), and then tiles are instant where `exportImage` is
  // not. Detect the cache independently of the service type.
  const cached = Boolean(meta.singleFusedMapCache && meta.tileInfo?.lods?.length);
  if (cached) {
    cacheLevels = meta.tileInfo.lods.map((l) => l.level);
    // The cached ladder usually runs deeper than the source's real detail, so
    // it cannot report native resolution. 0.5 m is the conservative middle for
    // state programmes; it only matters when two providers overlap.
    if (resolutionM === null) resolutionM = 0.5;
  } else if (resolutionM === null && typeof meta.maxScale === 'number' && meta.maxScale > 0) {
    resolutionM = (meta.maxScale * 0.0254) / 96;
  }

  const yearFromTitle = Number(
    (candidate.title.match(/(?<!\d)(19|20)\d{2}(?!\d)/g) ?? []).sort().pop() ?? 0,
  );
  const year =
    candidate.yearHint ||
    yearFromTitle ||
    Number((meta.timeInfo?.startTime ?? '').toString().slice(-13, -9)) ||
    (candidate.created ? new Date(candidate.created).getUTCFullYear() : 0) ||
    null;

  // `{bbox-epsg-3857}` is what MapLibre expands; keep the provider's own params.
  const query =
    `bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=${TILE_PX},${TILE_PX}` +
    '&format=png32&transparent=true&f=image';

  // Name first, extent second. "Montana NAIP" must not be offered for Idaho
  // just because the mosaic's bounding box reaches across the border.
  const haystack = `${candidate.title} ${base}`;
  const named = namedStates(haystack);
  const attributed = statesInExtent(extent);
  const states = named.length ? attributed.filter((hit) => named.includes(hit.abbr)) : attributed;
  if (states.length === 0) {
    return {
      ...candidate,
      rejected: named.length
        ? `named ${named.join('/')} but extent does not cover it`
        : 'extent in no single state',
    };
  }
  if (NOT_TRUE_COLOR.test(haystack)) {
    return { ...candidate, rejected: 'false colour (CIR/NIR/pan)' };
  }
  if (resolutionM !== null && resolutionM > MAX_RESOLUTION_M) {
    return { ...candidate, rejected: `coarse (${resolutionM.toFixed(2)} m)` };
  }
  if (year && year < MIN_YEAR) return { ...candidate, rejected: `stale (${year})` };

  return {
    title: candidate.title,
    url: base,
    owner: candidate.owner,
    cached,
    cacheLevels,
    resolutionM: resolutionM ? Number(resolutionM.toFixed(2)) : null,
    bounds: extent.map((v) => Number(v.toFixed(4))),
    span: [Number(spanLon.toFixed(2)), Number(spanLat.toFixed(2))],
    attribution: (meta.copyrightText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    year: year || null,
    named,
    states,
    template: cached
      ? `${base}/tile/{z}/{y}/{x}`
      : isImage
        ? `${base}/exportImage?${query}`
        : `${base}/export?${query}`,
  };
}

/**
 * Fetch real tiles and keep the fastest non-blank answer.
 *
 * Seven points, because a state's bounding box is mostly water or desert as
 * often as not: three points in a Maryland extent land in Chesapeake Bay and
 * the mosaic looks blank when it is fine. Two hits out of seven is enough.
 */
async function probe(described, { fractions: sampleFractions, timeoutMs = 12000 } = {}) {
  const fractions = sampleFractions ?? [
    [0.5, 0.5],
    [0.35, 0.6],
    [0.65, 0.4],
    [0.25, 0.3],
    [0.75, 0.7],
    [0.5, 0.25],
    [0.5, 0.75],
  ];
  const results = [];
  let firstGoodPoint = null;
  for (const [fx, fy] of fractions) {
    const [lon, lat] = samplePoint(described.bounds, fx, fy);
    let chosen = null;
    for (const url of requestUrlsFor(described, lon, lat)) {
      const first = await fetchBytes(url, timeoutMs);
      if (first.status !== 200 || first.bytes < MIN_BYTES) {
        chosen ??= { requestUrl: url, ...first };
        continue;
      }
      const second = await fetchBytes(url, timeoutMs);
      const best = second.bytes > 0 && second.ms < first.ms ? second : first;
      chosen = { requestUrl: url, ...best };
      firstGoodPoint ??= [lon, lat];
      break;
    }
    results.push(chosen);
    if (results.filter((r) => r.status === 200 && r.bytes >= MIN_BYTES).length >= 3) break;
  }
  const usable = results.filter((r) => r.status === 200 && r.bytes >= MIN_BYTES);
  if (usable.length < 2) {
    const sample = results.find((r) => r.status !== 200) ?? results[0];
    return {
      ...described,
      rejected: `blank/failed (${sample.status}, ${sample.bytes}B, ${sample.error ?? 'ok'})`,
      results,
    };
  }
  const fastest = usable.reduce((a, b) => (b.ms < a.ms ? b : a));
  if (fastest.ms > MAX_SECONDS * 1000) {
    return { ...described, rejected: `slow (${fastest.ms}ms)`, results };
  }
  const centerLat = (described.bounds[1] + described.bounds[3]) / 2;
  return {
    ...described,
    maxzoom: Math.max(16, Math.min(19, nativeZoom(described.resolutionM, centerLat))),
    evidence: {
      samples: usable.length,
      fastestMs: fastest.ms,
      bytes: usable.map((r) => r.bytes),
      statuses: results.map((r) => r.status),
      point: firstGoodPoint,
    },
    results,
  };
}

// ── ranking ────────────────────────────────────────────────────────────────

function rank(a, b, abbr) {
  // A statewide mosaic beats a metro/regional one even if the latter is newer:
  // DVRPC (Philadelphia region) must not stand in for New Jersey.
  const coverageOf = (d) => d.states?.find((s) => s.abbr === abbr)?.coverage ?? 1;
  const wa = coverageOf(a) < 0.7 ? 1 : 0;
  const wb = coverageOf(b) < 0.7 ? 1 : 0;
  if (wa !== wb) return wa - wb;
  // Newest flight next — a 1994 ortho is not an upgrade over NAIP.
  if ((a.year ?? 0) !== (b.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
  // Then cached tiles over dynamic renders.
  if (a.cached !== b.cached) return a.cached ? -1 : 1;
  // Then the finer source, then the faster one.
  const ra = a.resolutionM ?? 9;
  const rb = b.resolutionM ?? 9;
  if (Math.abs(ra - rb) > 0.05) return ra - rb;
  // `utility.arcgis.com/usrsvcs/servers/<guid>` endpoints are per-user proxies
  // of someone's server; they can be retired without notice.
  const pa = /usrsvcs/.test(a.url) ? 1 : 0;
  const pb = /usrsvcs/.test(b.url) ? 1 : 0;
  if (pa !== pb) return pa - pb;
  return (a.evidence?.fastestMs ?? 9e9) - (b.evidence?.fastestMs ?? 9e9);
}

// ── finalize: turn a sweep report into registry entries ────────────────────

const EARTH_RADIUS_M = 6378137;
const WEB_MERCATOR_ORIGIN = 20037508.342789244;
const EQUATOR_RESOLUTION = 156543.03392804097;

/**
 * True when the cache uses the global Web Mercator tiling scheme, i.e. its LOD
 * `n` is exactly MapLibre's zoom `n`.
 *
 * This matters: MapLibre computes `{z}/{y}/{x}` from the global scheme, so a
 * state cache with a custom LOD set (West Virginia's has levels 0..13 whose
 * finest is 0.07 m, not a zoom 13 tile at all) would silently serve the wrong
 * place. Those services must be asked through `export` instead, where the
 * server does the geometry.
 */
function standardLadder(meta) {
  const info = meta?.tileInfo;
  const lods = info?.lods;
  if (!info || !Array.isArray(lods) || lods.length === 0) return false;
  if (info.rows !== 256 || info.cols !== 256) return false;
  // ArcGIS reports the tiling origin as `[x, y]` for most services, but cached
  // ImageServers return the same pair as `{ x, y }`.
  const origin = info.origin ?? {};
  const ox = Array.isArray(origin) ? origin[0] : origin.x;
  const oy = Array.isArray(origin) ? origin[1] : origin.y;
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return false;
  if (Math.abs(ox + WEB_MERCATOR_ORIGIN) > 1 || Math.abs(oy - WEB_MERCATOR_ORIGIN) > 1) {
    return false;
  }
  return lods.every((lod) => {
    const expected = EQUATOR_RESOLUTION / 2 ** lod.level;
    return Math.abs(lod.resolution - expected) / expected < 0.01;
  });
}

const round4 = (v) => Number(v.toFixed(4));
const intersect = (a, b) => [
  round4(Math.max(a[0], b[0])),
  round4(Math.max(a[1], b[1])),
  round4(Math.min(a[2], b[2])),
  round4(Math.min(a[3], b[3])),
];

function exportTemplate(url) {
  const query =
    'bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256' +
    '&format=png32&transparent=true&f=image';
  return /ImageServer$/i.test(url) ? `${url}/exportImage?${query}` : `${url}/export?${query}`;
}

/**
 * Probe points for the final check: the point that already worked during the
 * sweep first, then a triangle around the centre. Re-probing only the centre is
 * how Maryland "failed" — its centre is Chesapeake Bay, while the sweep had a
 * land point on file.
 */
function finalizeFractions(entry, bounds) {
  const fractions = [
    [0.5, 0.5],
    [0.35, 0.6],
    [0.65, 0.4],
  ];
  const point = entry.best?.evidence?.point;
  const spanLon = bounds[2] - bounds[0];
  const spanLat = bounds[3] - bounds[1];
  if (point && spanLon > 0 && spanLat > 0) {
    const u = (point[0] - bounds[0]) / spanLon;
    const v = (point[1] - bounds[1]) / spanLat;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      fractions.unshift([Math.min(0.98, Math.max(0.02, u)), Math.min(0.98, Math.max(0.02, v))]);
    }
  }
  return fractions;
}

/** Re-read one winner and decide how it must be requested. */
async function finalizeService(entry) {
  const described = await describe({
    title: entry.best.title,
    url: entry.best.url,
    owner: entry.best.owner ?? '',
    created: 0,
    yearHint: entry.best.year,
    metaTimeoutMs: 45000,
  });
  if (described.rejected) return { ...entry, finalized: null, reason: described.rejected };

  const meta = await fetchJson(`${entry.best.url}?f=json`, 45000);
  const maxLevel = described.cacheLevels.length ? Math.max(...described.cacheLevels) : 0;
  const useTiles = described.cached && standardLadder(meta) && maxLevel >= 16;
  const stateBox = STATE_BOXES.find(([, abbr]) => abbr === entry.abbr).slice(2);
  const bounds = intersect(described.bounds, stateBox);
  const shaped = {
    ...described,
    cached: useTiles,
    bounds,
    template: useTiles ? `${described.url}/tile/{z}/{y}/{x}` : exportTemplate(described.url),
  };
  const probed = await probe(shaped, {
    fractions: finalizeFractions(entry, bounds),
    timeoutMs: 12000,
  });
  if (probed.rejected)
    return { ...entry, finalized: null, reason: probed.rejected, results: probed.results };
  const maxzoom = useTiles ? Math.min(maxLevel, 19) : Math.max(16, Math.min(19, probed.maxzoom));
  return {
    ...entry,
    finalized: {
      id: `ortho-us-${entry.abbr.toLowerCase()}`,
      state: entry.state,
      abbr: entry.abbr,
      url: described.url,
      template: shaped.template,
      tileSize: 256,
      minzoom: useTiles ? Math.min(13, maxzoom) : 13,
      maxzoom,
      resolutionM: described.resolutionM ?? 0.5,
      year: described.year,
      title: described.title,
      attribution: described.attribution || `${described.title} — ${new URL(described.url).host}`,
      bounds,
      tiles: useTiles,
      ladder: standardLadder(meta),
      evidence: probed.evidence,
    },
  };
}

const squeeze = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const quote = (value) => squeeze(value).replace(/'/g, "\\'");

/** "Arkansas Imagery 2023" under the state name should not repeat the state. */
function describeLabel(f) {
  const title = squeeze(f.title);
  const stripped = title.replace(new RegExp(`^${f.state}[\\s—:-]+`, 'i'), '').trim();
  const name = stripped || title;
  return f.year && !name.includes(f.year) ? `${name} (${f.year})` : name;
}

function emitTs(finalized) {
  const lines = [];
  for (const entry of finalized) {
    const f = entry.finalized;
    lines.push('  {');
    lines.push(`    id: '${f.id}',`);
    lines.push(`    label: '${f.state} — ${quote(describeLabel(f))}',`);
    lines.push(`    tiles: ['${f.template}'],`);
    lines.push('    tileSize: 256,');
    lines.push('    transparentBlank: true,');
    lines.push(`    minzoom: ${f.minzoom},`);
    lines.push(`    maxzoom: ${f.maxzoom},`);
    lines.push(`    resolutionM: ${f.resolutionM},`);
    if (f.year) lines.push(`    acquiredAt: '${f.year}-01-01',`);
    lines.push(`    attribution: '${quote(f.attribution)}',`);
    lines.push(`    bounds: [${f.bounds.join(', ')}],`);
    lines.push('  },');
  }
  return lines.join('\n');
}

async function finalizeReport(reportPath, { only, emit }) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const wanted = report.states.filter(
    (st) => st.best && (only.length === 0 || only.includes(st.abbr)),
  );
  const finalized = await pool(wanted, 6, async (entry) => {
    let result;
    try {
      result = await finalizeService(entry);
    } catch (err) {
      if (process.env.ORTHO_DEBUG) process.stderr.write(`${entry.abbr} STACK ${err?.stack}\n`);
      result = { ...entry, finalized: null, reason: `threw: ${String(err?.message ?? err)}` };
    }
    const f = result.finalized;
    process.stderr.write(
      f
        ? `   ${result.abbr}: ${f.tiles ? 'tile' : 'export'} ${f.resolutionM}m z${f.minzoom}-${f.maxzoom} ` +
            `${f.evidence.fastestMs}ms  ${f.url}\n`
        : `   ${result.abbr}: dropped — ${result.reason}\n`,
    );
    return result;
  });
  const usable = finalized.filter((entry) => entry.finalized);
  process.stderr.write(`\n${usable.length} registry entr(y/ies) ready\n`);
  const ts = emitTs(usable);
  if (emit) {
    await writeFile(emit, `${ts}\n`);
    process.stderr.write(`entries → ${emit}\n`);
  } else {
    process.stdout.write(`${ts}\n`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  const jsonOut = valueOf('--json');
  const dumpDir = valueOf('--dump-tiles');
  const finalizePath = valueOf('--finalize');
  const emitPath = valueOf('--emit');
  const only = args
    .filter((a) => !a.startsWith('--') && ![jsonOut, dumpDir, finalizePath, emitPath].includes(a))
    .map((a) => a.toUpperCase());

  if (finalizePath) {
    await finalizeReport(finalizePath, { only, emit: emitPath });
    return;
  }

  const wanted = only.length ? STATE_BOXES.filter(([, ab]) => only.includes(ab)) : STATE_BOXES;

  process.stderr.write('Sweeping the ArcGIS Online item index…\n');
  const candidates = await sweep();
  process.stderr.write(`${candidates.length} imagery service(s) to inspect\n`);

  const descriptions = await pool(candidates, FETCH_CONCURRENCY, describe);
  const stateRelevant = descriptions.filter(
    (d) => !d.rejected && d.states?.length > 0 && d.states.length <= MAX_STATES_PER_SOURCE,
  );
  process.stderr.write(
    `${stateRelevant.length} state-scale service(s) across ` +
      `${new Set(stateRelevant.flatMap((d) => d.states.map((s) => s.abbr))).size} state(s)\n`,
  );

  // Only the best few per state need a tile probe.
  const perState = new Map();
  for (const d of stateRelevant) {
    for (const { abbr } of d.states) {
      if (!perState.has(abbr)) perState.set(abbr, []);
      perState.get(abbr).push(d);
    }
  }
  const toProbe = [];
  for (const [abbr, list] of perState) {
    list.sort((a, b) => rank(a, b, abbr));
    toProbe.push(...list.slice(0, 4));
  }
  const unique = [...new Map(toProbe.map((d) => [d.url, d])).values()];
  process.stderr.write(`probeing ${unique.length} service(s) with real tiles\n`);
  const probed = await pool(unique, PROBE_CONCURRENCY, probe);
  const probedByUrl = new Map(probed.filter((p) => !p.rejected).map((p) => [p.url, p]));

  const report = { generatedAt: new Date().toISOString(), states: [] };
  for (const [state, abbr] of wanted) {
    const list = (perState.get(abbr) ?? [])
      .map((d) => probedByUrl.get(d.url))
      .filter(Boolean)
      .sort((a, b) => rank(a, b, abbr));
    const best = list[0] ?? null;
    const candidatesForState = (perState.get(abbr) ?? []).sort((a, b) => rank(a, b, abbr));
    if (best) {
      process.stderr.write(
        `   ${abbr}: OK ${best.cached ? 'cached' : 'export'} ${best.resolutionM}m ` +
          `z${best.maxzoom} ${best.evidence.fastestMs}ms  ${best.url}\n`,
      );
    } else {
      const near = candidatesForState
        .slice(0, 2)
        .map((c) => `${c.title} (${c.year ?? '?'})`)
        .join(' | ');
      process.stderr.write(`   ${abbr}: none — ${near || 'no state-scale service found'}\n`);
    }
    report.states.push({
      state,
      abbr,
      best,
      considered: candidatesForState.length,
      candidates: candidatesForState.slice(0, 8),
    });
  }

  const found = report.states.filter((s) => s.best);
  if (dumpDir) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dumpDir, { recursive: true });
    await pool(found, 6, async (entry) => {
      const [lon, lat] = entry.best.evidence?.point ?? [
        (entry.best.bounds[0] + entry.best.bounds[2]) / 2,
        (entry.best.bounds[1] + entry.best.bounds[3]) / 2,
      ];
      const { status, buf } = await sampleTile(
        entry.best,
        (lon - entry.best.bounds[0]) / (entry.best.bounds[2] - entry.best.bounds[0]),
        (lat - entry.best.bounds[1]) / (entry.best.bounds[3] - entry.best.bounds[1]),
      );
      if (status !== 200 || buf.length < MIN_BYTES) {
        process.stderr.write(`   ${entry.abbr}: no contact-sheet tile (${status})\n`);
        return null;
      }
      await writeFile(`${dumpDir}/${entry.abbr}.png`, buf);
      return null;
    });
    process.stderr.write(`contact sheet → ${dumpDir}/<state>.png\n`);
  }
  process.stderr.write(`\n${found.length}/${report.states.length} states resolved\n`);
  const payload = JSON.stringify(report, null, 2);
  if (jsonOut) {
    await writeFile(jsonOut, payload);
    process.stderr.write(`report → ${jsonOut}\n`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
