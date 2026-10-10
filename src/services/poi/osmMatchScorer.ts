/**
 * Score an OpenStreetMap element as a possible duplicate of a place we are
 * about to submit.
 *
 * This mirrors the signals Overture uses when conflating place records: name
 * similarity (core words ignored), category compatibility, spatial distance,
 * and strong identifiers (brand Wikidata QID, phone, website). The scorer is
 * deliberately biased toward recognising a duplicate — a missed duplicate is
 * worse than occasionally treating a nearby look-alike as already mapped.
 */
import { nameSimilarity } from '../../utils/osmNameMatch';
import { haversineMeters } from '../../utils/routeSnap';

/** A candidate OSM element (node / way / relation) returned by Overpass. */
export interface OsmCandidate {
  type: string;
  id: number;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

/** Primary tag keys, most specific POI kinds first. */
const PRIMARY_KEYS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'craft',
  'office',
  'healthcare',
  'historic',
  'public_transport',
] as const;

export interface PrimaryTag {
  type: string;
  value: string;
}

/** Derive the POI's primary OSM tag (e.g. `amenity=restaurant`). */
export function derivePrimaryTag(tags: Record<string, string>): PrimaryTag | null {
  for (const key of PRIMARY_KEYS) {
    const value = tags[key];
    if (value) return { type: key, value };
  }
  return null;
}

/** Values that often cover a large area, so their OSM feature centre drifts. */
const LARGE_FEATURE_VALUES = new Set([
  'park',
  'garden',
  'camp_site',
  'university',
  'college',
  'school',
  'hospital',
  'airport',
  'beach',
  'viewpoint',
  'museum',
  'place_of_worship',
  'grave_yard',
  'cemetery',
  'stadium',
  'mall',
  'department_store',
  'supermarket',
  'theatre',
  'cinema',
  'zoo',
  'theme_park',
  'nature_reserve',
  'parking',
  'bus_station',
  'train_station',
]);

const SMALL_FEATURE_VALUES = new Set(['atm', 'bench', 'drinking_water']);

/** Category-aware search radius: bigger features need a bigger tolerance. */
export function matchRadiusMeters(tags: Record<string, string>): number {
  const primary = derivePrimaryTag(tags);
  if (!primary) return 120;
  if (LARGE_FEATURE_VALUES.has(primary.value)) return 250;
  if (SMALL_FEATURE_VALUES.has(primary.value)) return 80;
  return 120;
}

export type CategoryCompatibility = 'exact' | 'group' | 'mismatch' | 'unknown';

/** Compare the target's primary tag with a candidate's. */
export function categoryCompatibility(
  target: PrimaryTag | null,
  candidate: PrimaryTag | null,
): CategoryCompatibility {
  if (!target || !candidate) return 'unknown';
  if (target.type === candidate.type && target.value === candidate.value) return 'exact';
  if (target.type === candidate.type) return 'group';
  return 'mismatch';
}

const NAME_KEYS = [
  'name',
  'name:en',
  'alt_name',
  'official_name',
  'short_name',
  'loc_name',
  'old_name',
  'brand',
  'operator',
];

function firstTag(tags: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = tags[key];
    if (value) return value;
  }
  return undefined;
}

/** Digits-only phone, dropping a leading US country code when present. */
function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** Normalized `host + path` so `www.` and trailing slashes don't matter. */
function normalizeWebsite(raw?: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function normalizeWikidata(raw?: string): string | null {
  if (!raw) return null;
  const match = raw
    .trim()
    .toUpperCase()
    .match(/^Q\d+$/);
  return match ? match[0] : null;
}

export interface OsmMatchTarget {
  name: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

export interface OsmMatchResult {
  match: boolean;
  score: number;
  reasons: string[];
}

// Name-similarity thresholds. Near-exact names match regardless of category;
// moderately similar names need category agreement.
const NEAR_EXACT_NAME = 0.97;
const STRONG_NAME = 0.9;
const OK_NAME = 0.82;

/** Decide whether a candidate OSM element is the same place as the target. */
export function classifyOsmMatch(target: OsmMatchTarget, candidate: OsmCandidate): OsmMatchResult {
  const radius = matchRadiusMeters(target.tags);
  const distance = haversineMeters([target.lng, target.lat], [candidate.lng, candidate.lat]);
  if (!Number.isFinite(distance) || distance > radius) {
    return { match: false, score: 0, reasons: ['out-of-range'] };
  }

  const targetPrimary = derivePrimaryTag(target.tags);
  const candidatePrimary = derivePrimaryTag(candidate.tags);
  const compat = categoryCompatibility(targetPrimary, candidatePrimary);

  let nameSim = 0;
  for (const key of NAME_KEYS) {
    const value = candidate.tags[key];
    if (!value) continue;
    const sim = nameSimilarity(target.name, value);
    if (sim > nameSim) nameSim = sim;
  }

  const reasons: string[] = [];
  const targetWikidata = normalizeWikidata(
    firstTag(target.tags, ['brand:wikidata', 'operator:wikidata', 'wikidata']),
  );
  const candidateWikidata = normalizeWikidata(
    firstTag(candidate.tags, ['brand:wikidata', 'operator:wikidata', 'wikidata']),
  );
  const wikidataMatch = !!targetWikidata && targetWikidata === candidateWikidata;

  const targetPhone = normalizePhone(
    firstTag(target.tags, ['phone', 'contact:phone', 'telephone']),
  );
  const candidatePhone = normalizePhone(
    firstTag(candidate.tags, ['phone', 'contact:phone', 'telephone']),
  );
  const phoneMatch = !!targetPhone && targetPhone === candidatePhone;

  const targetSite = normalizeWebsite(firstTag(target.tags, ['website', 'contact:website', 'url']));
  const candidateSite = normalizeWebsite(
    firstTag(candidate.tags, ['website', 'contact:website', 'url']),
  );
  const websiteMatch = !!targetSite && targetSite === candidateSite;

  if (wikidataMatch) reasons.push('brand:wikidata');
  if (phoneMatch) reasons.push('phone');
  if (websiteMatch) reasons.push('website');

  let match = false;
  let score = nameSim;
  if (wikidataMatch || phoneMatch || websiteMatch) {
    match = true;
    score = Math.max(score, 0.95);
  } else if (nameSim >= NEAR_EXACT_NAME) {
    match = true;
  } else if (nameSim >= STRONG_NAME && compat !== 'mismatch') {
    match = true;
  } else if (nameSim >= OK_NAME && compat === 'exact') {
    match = true;
  } else if (nameSim >= OK_NAME && compat === 'group' && distance <= radius / 2) {
    match = true;
  }

  if (match) {
    reasons.push(`name=${nameSim.toFixed(2)}`, `cat=${compat}`, `d=${Math.round(distance)}m`);
  }
  return { match, score, reasons };
}
