/**
 * What a region pack contains, and how big it is — one answer for every card.
 *
 * The region card and the "Downloaded" shelf both describe a pack; keeping the
 * mapping here stops them from disagreeing about it.
 */

import type { Region } from '../../models/region';
import { REGION_CATALOG } from '../../constants/regionCatalog';

/** Asset file name → the feature it provides, in display order. */
export const ASSET_FEATURE_LABELS: Record<string, string> = {
  'tiles.pmtiles': 'Maps',
  'search.sqlite': 'Search',
  'transit.sqlite': 'Transit',
  'transit-timetable.sqlite': 'Timetable',
  'geocoding-data.sqlite': 'Geocoding',
};

/** Bytes the pack's manifest will actually transfer. */
export function manifestBytes(region: Region): number {
  return (region.assets ?? []).reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
}

/**
 * Size to show for a pack, in bytes (0 when nothing is known).
 *
 * The manifest wins over the legacy per-part columns: it is what downloads, and
 * the legacy columns are coarse catalog estimates of which a given row may carry
 * only one. New York Metro's row has just its geocoding estimate (194 MB), so
 * preferring the legacy sum advertised a 93 MB pack as 185 MB.
 */
export function packSizeBytes(region: Region): number {
  const fromManifest = manifestBytes(region);
  if (fromManifest > 0) return fromManifest;
  return (
    (region.tilesSizeBytes ?? 0) +
    (region.routingSizeBytes ?? 0) +
    (region.geocodingSizeBytes ?? 0) +
    (region.placesSizeBytes ?? 0)
  );
}

/** Feature labels the pack ships, deduped and in manifest order. */
export function packFeatureLabels(region: Region): string[] {
  const labels = (region.assets ?? [])
    .map((asset) => ASSET_FEATURE_LABELS[asset.name])
    .filter((label): label is string => label != null);
  return [...new Set(labels)];
}

/** `Maps · Search · Transit`, or null when the pack lists no known assets. */
export function packContentsLabel(region: Region): string | null {
  const labels = packFeatureLabels(region);
  return labels.length > 0 ? labels.join(' · ') : null;
}

/** Size formatted as `88 MB`, or null when unknown. */
export function formatPackSize(bytes: number): string | null {
  if (bytes <= 0) return null;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * What a pack covers, at the coarsest useful level.
 *
 * Two packs can share a name and overlap — `New York` is the Geofabrik *state*
 * extract while `New York Metro` is that same extract clipped to the city — so
 * a card needs to say which kind it is. Searched side by side, "New York" and
 * "New York Metro" gave no clue which one covered upstate.
 */
export type PackScope = 'metro' | 'regional';

/** Curated city packs are the ones in the bundled metro catalogue. */
const METRO_PACK_IDS = new Set(REGION_CATALOG.map((entry) => entry.id));

/**
 * Metro or regional, from two independent signals.
 *
 * Catalogue membership covers the curated packs this build knows about;
 * shipping a transit timetable covers metro packs published later, since only
 * city packs include one. Either is enough — neither alone is future-proof.
 */
export function packScope(region: Region): PackScope {
  if (METRO_PACK_IDS.has(region.id)) return 'metro';
  if ((region.assets ?? []).some((asset) => asset.name === 'transit-timetable.sqlite')) {
    return 'metro';
  }
  return 'regional';
}

/** Short badge text for {@link packScope}. */
export function packScopeLabel(region: Region): string {
  return packScope(region) === 'metro' ? 'Metro' : 'Regional';
}

/** One-line scope hint, for accessibility labels and the downloaded shelf. */
export function packScopeDescription(region: Region): string {
  return packScope(region) === 'metro'
    ? 'Metro pack — a city-sized area'
    : 'Regional pack — a whole state, province or country';
}
