#!/usr/bin/env node
/**
 * Lightweight Overture Maps Places proxy server.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Database } from 'duckdb-async';

const PORT = parseInt(process.env.PORT ?? '4100', 10);

// Overture release used by the project (kept in sync with config.ts)
const OVERTURE_RELEASE = '2026-02-18.0';
const OVERTURE_S3 =
  `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/*/*`;

// ---------------------------------------------------------------------------
// DuckDB singleton with httpfs + spatial
// ---------------------------------------------------------------------------
let db = null;

async function getDb() {
  if (db) return db;
  db = await Database.create(':memory:');
  await db.exec(`
    INSTALL httpfs;  LOAD httpfs;
    INSTALL spatial; LOAD spatial;
    SET s3_region = 'us-west-2';
  `);
  return db;
}

export function clampLimit(limitStr) {
  const parsed = parseInt(limitStr ?? '200', 10);
  const val = isNaN(parsed) ? 200 : parsed;
  return Math.min(Math.max(val, 1), 1000);
}

export function parseBboxParam(bbox) {
  if (!bbox) {
    return { error: 'Missing required query parameter: bbox' };
  }

  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return { error: 'bbox must be 4 comma-separated numbers: west,south,east,north' };
  }

  const [west, south, east, north] = parts;
  if (west >= east || south >= north) {
    return { error: 'bbox must satisfy west < east and south < north' };
  }

  return { west, south, east, north };
}

export function buildQueryArgs(west, south, east, north, limit) {
  return [east, west, north, south, limit];
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

async function queryPlaces(west, south, east, north, limit) {
  const conn = await getDb();

  const sql = `
    SELECT
      id,
      names,
      categories,
      confidence,
      websites,
      socials,
      emails,
      phones,
      brand,
      addresses,
      sources,
      ST_Y(geometry)  AS lat,
      ST_X(geometry)  AS lng
    FROM read_parquet('${OVERTURE_S3}', hive_partitioning=true)
    WHERE bbox.xmin <= $1
      AND bbox.xmax >= $2
      AND bbox.ymin <= $3
      AND bbox.ymax >= $4
    LIMIT $5
  `;

  const rows = await conn.all(sql, ...buildQueryArgs(west, south, east, north, limit));

  return rows.map((r) => ({
    type: 'Feature',
    id: r.id,
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      id: r.id,
      names: tryParse(r.names),
      categories: tryParse(r.categories),
      confidence: r.confidence ?? undefined,
      websites: tryParse(r.websites) ?? undefined,
      socials: tryParse(r.socials) ?? undefined,
      emails: tryParse(r.emails) ?? undefined,
      phones: tryParse(r.phones) ?? undefined,
      brand: tryParse(r.brand) ?? undefined,
      addresses: tryParse(r.addresses) ?? undefined,
      sources: tryParse(r.sources) ?? undefined,
    },
  }));
}

function tryParse(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return val; }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

export function createServer(queryImpl = queryPlaces, port = PORT) {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname !== '/v1/places') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const parsed = parseBboxParam(url.searchParams.get('bbox'));
    if ('error' in parsed) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: parsed.error }));
      return;
    }

    const limit = clampLimit(url.searchParams.get('limit'));

    try {
      const features = await queryImpl(parsed.west, parsed.south, parsed.east, parsed.north, limit);
      const geojson = { type: 'FeatureCollection', features };

      res.writeHead(200, { 'Content-Type': 'application/geo+json' });
      res.end(JSON.stringify(geojson));
    } catch (err) {
      console.error('[overture-proxy] query error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[overture-proxy] listening on http://localhost:${PORT}`);
    console.log(`[overture-proxy] GET /v1/places?bbox=west,south,east,north&limit=200`);
    console.log(`[overture-proxy] Overture release: ${OVERTURE_RELEASE}`);
  });
}
