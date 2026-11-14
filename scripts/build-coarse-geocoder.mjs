#!/usr/bin/env node
/**
 * Build the bundled coarse geocoder.
 *
 * Polaris answers geocoding from downloaded region packs, but a cold install —
 * or a point outside every downloaded pack — has no local bytes at all. This
 * asset fills exactly that hole: a few thousand cities plus their country and
 * first-level administrative area, small enough to ship inside the app binary.
 *
 * Deliberately not a geocoder: it resolves a coordinate to the nearest known
 * city and a search term to a city, nothing finer. The pack layer and (for
 * builds that opt in) Nominatim remain strictly better answers.
 *
 * Usage:
 *   node scripts/build-coarse-geocoder.mjs \
 *     [--cities path/to/cities1000.txt] [--admin1 path/to/admin1CodesASCII.txt] \
 *     [--max-cities 6000] [--out src/constants/coarseGeocoder.json]
 *
 * Inputs come from GeoNames (CC BY 4.0):
 *   https://download.geonames.org/export/dump/cities1000.zip
 *   https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *
 * The output is committed so a normal build needs no network.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function flag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  return value;
}

const CITIES_PATH = resolve(flag('--cities', 'cities1000.txt'));
const ADMIN1_PATH = resolve(flag('--admin1', 'admin1CodesASCII.txt'));
const MAX_CITIES = Number(flag('--max-cities', '6000'));
const OUT_PATH = resolve(flag('--out', 'src/constants/coarseGeocoder.json'));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('see the header of scripts/build-coarse-geocoder.mjs for usage');
  process.exit(0);
}

/** admin1 code (`US.MA`) → human name (`Massachusetts`). */
function readAdmin1(path) {
  const names = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    const [code, name] = line.split('\t');
    if (code && name) names.set(code, name);
  }
  return names;
}

/**
 * cities1000.txt is tab separated:
 * geonameid, name, asciiname, alternatenames, lat, lng, class, code, country,
 * cc2, admin1, admin2, admin3, admin4, population, ...
 */
function readCities(path) {
  const rows = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 15) continue;
    const lat = Number(f[4]);
    const lng = Number(f[5]);
    const population = Number(f[14]) || 0;
    const geonameId = Number(f[0]);
    const name = f[1];
    const country = f[8];
    const admin1 = f[10];
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push({ geonameId, name, lat, lng, country, admin1, population });
  }
  return rows;
}

/** Trim coordinates to ~11 m; a city centroid does not need more. */
function round(value) {
  return Math.round(value * 1e4) / 1e4;
}

const admin1Names = readAdmin1(ADMIN1_PATH);
const all = readCities(CITIES_PATH);

all.sort((a, b) => b.population - a.population);
const kept = all.slice(0, MAX_CITIES);

// Only the admin1 entries actually referenced, so the name table stays small.
const usedAdmin1 = new Set();
for (const city of kept) {
  if (city.admin1 && admin1Names.has(`${city.country}.${city.admin1}`)) {
    usedAdmin1.add(`${city.country}.${city.admin1}`);
  }
}

const admin1 = {};
for (const code of [...usedAdmin1].sort()) {
  admin1[code] = admin1Names.get(code);
}

// Positional rows keep the asset compact:
// [geonameId, name, lat, lng, countryCode, admin1Code, population].
//
// The GeoNames id is kept so a bundled city keeps a stable identity across
// rebuilds — search results carry it as their id, and the download-backed
// GeoNames tier uses the same ids.
const cities = kept.map((city) => [
  city.geonameId,
  city.name,
  round(city.lat),
  round(city.lng),
  city.country,
  city.admin1 || '',
  city.population,
]);

const payload = { v: 1, source: 'geonames cities1000', cities, admin1 };
writeFileSync(OUT_PATH, JSON.stringify(payload));

const bytes = statSync(OUT_PATH).size;
console.log(`cities:      ${all.length} available, ${cities.length} kept`);
console.log(`admin1 names: ${Object.keys(admin1).length}`);
console.log(`smallest kept population: ${kept.at(-1)?.population ?? 0}`);
console.log(`written:     ${OUT_PATH} (${(bytes / 1024).toFixed(0)} kB)`);
