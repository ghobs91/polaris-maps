/**
 * Bundled coarse geocoder — both directions.
 *
 * Geocoding is answered from downloaded region packs, but two states have no
 * local pack at all: a cold install, and a point outside every downloaded
 * region. Without something bundled, those states resolve to *nothing* — which
 * is precisely the gap a network geocoder used to fill, and the reason a
 * per-query dependency crept in.
 *
 * This layer closes the gap with bytes that already ship in the binary: the
 * ~6,000 largest cities (GeoNames `cities1000`, CC BY 4.0) with their country
 * and first-level administrative area.
 *
 * - {@link nearestCoarsePlace}: coordinate → country / area / nearest city.
 * - {@link searchCoarseCities}: query → cities, feeding the same `cities`
 *   search stage the optional downloaded GeoNames database produces.
 *
 * It answers "where am I, roughly" and "which city is that" — nothing finer.
 * A pack is always the better answer, so this is only consulted after every
 * pack tier has missed, or when the larger GeoNames download is absent.
 *
 * Regenerate the asset with `pnpm geo:coarse` (see
 * `scripts/build-coarse-geocoder.mjs`); the output is committed so a normal
 * build needs no network.
 *
 * The dataset is `require`d lazily and parsed once: a device that never leaves
 * its pack coverage never pays for it.
 */

/** Beyond this the nearest known city says nothing useful about the point. */
export const MAX_COARSE_DISTANCE_KM = 500;

export interface CoarsePlace {
  city: string;
  /** First-level administrative area name, when GeoNames knows it. */
  admin1: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  distanceKm: number;
  population: number;
}

interface CoarsePayload {
  v: number;
  /** `[geonameId, name, lat, lng, countryCode, admin1Code, population]` */
  cities: [number, string, number, number, string, string, number][];
  /** `"US.MA"` → `"Massachusetts"` */
  admin1: Record<string, string>;
}

/** A bundled city, shape-compatible with the GeoNames tier's `GlobalPlace`. */
export interface CoarseCity {
  geonameId: number;
  name: string;
  /** `"Boston, Massachusetts, United States"` for display. */
  displayName: string;
  lat: number;
  lng: number;
  population: number;
  countryCode: string;
}

interface CoarseDataset {
  places: (CoarseCity & { admin1: string | null; country: string })[];
}

let dataset: CoarseDataset | null = null;

/** Lazily load and flatten the bundled dataset (once per process). */
function loadDataset(): CoarseDataset {
  if (dataset) return dataset;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const payload = require('../../constants/coarseGeocoder.json') as CoarsePayload;
  const places = payload.cities.map(
    ([geonameId, name, lat, lng, countryCode, admin1Code, population]) => {
      const admin1 = payload.admin1[`${countryCode}.${admin1Code}`] ?? null;
      const country = countryName(countryCode);
      return {
        geonameId,
        name,
        displayName: [name, admin1, country].filter(Boolean).join(', '),
        lat,
        lng,
        population,
        countryCode,
        admin1,
        country,
      };
    },
  );

  dataset = { places };
  return dataset;
}

/** Great-circle distance in kilometres. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Country names for the codes the dataset contains.
 *
 * Only codes present in the asset are listed; an unknown code falls back to the
 * code itself rather than to an empty string, so a stale asset degrades to
 * "US" instead of to nothing.
 */
const COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra',
  AE: 'United Arab Emirates',
  AF: 'Afghanistan',
  AL: 'Albania',
  AM: 'Armenia',
  AO: 'Angola',
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BF: 'Burkina Faso',
  BG: 'Bulgaria',
  BH: 'Bahrain',
  BI: 'Burundi',
  BJ: 'Benin',
  BO: 'Bolivia',
  BR: 'Brazil',
  BY: 'Belarus',
  CA: 'Canada',
  CD: 'DR Congo',
  CH: 'Switzerland',
  CI: "Côte d'Ivoire",
  CL: 'Chile',
  CM: 'Cameroon',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CU: 'Cuba',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  DO: 'Dominican Republic',
  DZ: 'Algeria',
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  ES: 'Spain',
  ET: 'Ethiopia',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GE: 'Georgia',
  GH: 'Ghana',
  GR: 'Greece',
  GT: 'Guatemala',
  HN: 'Honduras',
  HR: 'Croatia',
  HT: 'Haiti',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IQ: 'Iraq',
  IR: 'Iran',
  IT: 'Italy',
  JM: 'Jamaica',
  JO: 'Jordan',
  JP: 'Japan',
  KE: 'Kenya',
  KG: 'Kyrgyzstan',
  KH: 'Cambodia',
  KR: 'South Korea',
  KW: 'Kuwait',
  KZ: 'Kazakhstan',
  LB: 'Lebanon',
  LK: 'Sri Lanka',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  LY: 'Libya',
  MA: 'Morocco',
  MD: 'Moldova',
  ME: 'Montenegro',
  MG: 'Madagascar',
  MK: 'North Macedonia',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MX: 'Mexico',
  MY: 'Malaysia',
  MZ: 'Mozambique',
  NG: 'Nigeria',
  NI: 'Nicaragua',
  NL: 'Netherlands',
  NO: 'Norway',
  NP: 'Nepal',
  NZ: 'New Zealand',
  OM: 'Oman',
  PA: 'Panama',
  PE: 'Peru',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PR: 'Puerto Rico',
  PT: 'Portugal',
  PY: 'Paraguay',
  QA: 'Qatar',
  RO: 'Romania',
  RS: 'Serbia',
  RU: 'Russia',
  RW: 'Rwanda',
  SA: 'Saudi Arabia',
  SD: 'Sudan',
  SE: 'Sweden',
  SG: 'Singapore',
  SI: 'Slovenia',
  SK: 'Slovakia',
  SN: 'Senegal',
  SO: 'Somalia',
  SY: 'Syria',
  TH: 'Thailand',
  TJ: 'Tajikistan',
  TM: 'Turkmenistan',
  TN: 'Tunisia',
  TR: 'Türkiye',
  TW: 'Taiwan',
  TZ: 'Tanzania',
  UA: 'Ukraine',
  UG: 'Uganda',
  US: 'United States',
  UY: 'Uruguay',
  UZ: 'Uzbekistan',
  VE: 'Venezuela',
  VN: 'Vietnam',
  YE: 'Yemen',
  ZA: 'South Africa',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
};

function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

/**
 * Nearest bundled city to a coordinate.
 *
 * A linear scan over a few thousand rows is deliberately chosen over a spatial
 * index: this runs only when no pack covers the point, so it is not a hot path,
 * and the whole dataset is a single flat array already in memory.
 *
 * Returns null beyond {@link MAX_COARSE_DISTANCE_KM} — a pin in open ocean
 * should resolve to "nothing known" rather than to a city a continent away.
 */
export function nearestCoarsePlace(lat: number, lng: number): CoarsePlace | null {
  const { places } = loadDataset();

  let best: (typeof places)[number] | null = null;
  let bestDistance = Infinity;

  for (const place of places) {
    // Cheap rejection before the trigonometry: no bundled city is further than
    // this from the point, so it cannot be the nearest.
    if (best && Math.abs(place.lat - lat) * 111 > bestDistance) continue;
    const d = distanceKm(lat, lng, place.lat, place.lng);
    if (d < bestDistance) {
      best = place;
      bestDistance = d;
    }
  }

  if (!best || bestDistance > MAX_COARSE_DISTANCE_KM) return null;

  return {
    city: best.name,
    admin1: best.admin1,
    country: best.country,
    countryCode: best.countryCode,
    lat: best.lat,
    lng: best.lng,
    population: best.population,
    distanceKm: bestDistance,
  };
}

/** Test-only: drop the parsed dataset so a reload can be exercised. */
export function __resetCoarseGeocoderForTests(): void {
  dataset = null;
}

/** Population tiers used for ranking, mirroring the GeoNames tier's bonuses. */
function populationBonus(population: number): number {
  if (population > 1_000_000) return -50;
  if (population > 100_000) return -30;
  if (population > 10_000) return -10;
  return 0;
}

/**
 * How well a bundled city name answers the query, lower is better.
 *
 * Mirrors the shape of the FTS ranking in `globalGeocoderService`: an exact
 * name beats a prefix, a prefix beats a substring, and anything that does not
 * contain the query at all does not match.
 */
function nameMatchScore(name: string, query: string): number | null {
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 10 + (lower.length - query.length);
  if (lower.includes(query)) return 40 + lower.indexOf(query);
  return null;
}

/**
 * Cities matching a query, ranked like the downloaded GeoNames tier.
 *
 * Feeds the `cities` stage of unified search when the (much larger) GeoNames
 * database has not been downloaded — the cold-install case, where searching a
 * city name would otherwise depend on a network geocoder.
 *
 * Returns an empty array rather than throwing: a search stage must degrade, not
 * fail.
 */
export function searchCoarseCities(
  query: string,
  refLat?: number,
  refLng?: number,
  limit: number = 10,
): CoarseCity[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];

  const { places } = loadDataset();
  const scored: { place: (typeof places)[number]; score: number }[] = [];

  for (const place of places) {
    const match = nameMatchScore(place.name, normalized);
    if (match === null) continue;
    // Same weighting as the GeoNames tier so switching between the two does
    // not change the ordering the ranker sees.
    let score = match + populationBonus(place.population);
    if (refLat != null && refLng != null) {
      score += ((place.lat - refLat) ** 2 + (place.lng - refLng) ** 2) * 0.01;
    }
    scored.push({ place, score });
  }

  scored.sort((a, b) => a.score - b.score || b.place.population - a.place.population);

  return scored.slice(0, Math.max(1, limit)).map(({ place }) => ({
    geonameId: place.geonameId,
    name: place.name,
    displayName: place.displayName,
    lat: place.lat,
    lng: place.lng,
    population: place.population,
    countryCode: place.countryCode,
  }));
}

/**
 * True when a token is the exact name of a bundled city.
 *
 * Same contract — and the same population floor — as the GeoNames-backed
 * `isKnownCityName`, so "tatte boston" is recognised as a destination even with
 * no download. The bundled set only contains cities above ~100k people, so it
 * is a strict subset of what the downloaded tier would accept.
 */
export function isBundledCityName(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (normalized.length < 3) return false;

  const { places } = loadDataset();
  return places.some(
    (place) => place.population >= 5000 && place.name.toLowerCase() === normalized,
  );
}
