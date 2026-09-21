/**
 * Unified search orchestrator.
 *
 * Replaces the bifurcated "category OR geocoding" flow with a single
 * pipeline that runs multiple search strategies in parallel, merges
 * results, and applies unified relevance scoring.
 *
 * Search sources (in parallel):
 * 1. Local FTS5 — instant, offline, searches places table by name/brand/category
 * 2. Category search — Overpass + Nominatim POI-class search for recognized categories
 * 3. Photon geocoder — fuzzy, typo-tolerant OSM-based search (POIs + addresses)
 * 4. Address geocoding — local FTS5 geocoding_entries + Nominatim fallback
 *
 * Results are deduplicated, scored, and returned in relevance order.
 */

import type { OsmPoi } from '../poi/osmFetcher';
import { PLACE_CATEGORIES, type Place, type PlaceCategory } from '../../models/poi';
import type { GeocodingResult } from '../geocoding/geocodingService';
import { searchPlacesFts } from '../poi/poiService';
import { searchByCategory, type CategorySearchResult } from '../poi/categorySearchService';
import { searchAddress } from '../geocoding/geocodingService';
import { throwIfAborted } from './abortUtils';
import { searchPhoton, type PhotonResult } from './photonGeocoder';
import {
  parseSearchQuery,
  fuzzyMatchBrand,
  isAddressQuery,
  normalizeSearchText,
  type ParsedSearchQuery,
} from './queryParser';
import { fetchOverturePlaces } from '../poi/overtureFetcher';
import { fetchOsmPoisByName } from '../poi/osmFetcher';
import {
  scoreAndRank,
  deduplicateResults,
  textMatchScore,
  type ScoredResult,
} from './searchRanker';
import { placeToOsmPoi } from '../../utils/placeToOsmPoi';
import { cachedFetch, cacheKey, boundsKey } from './searchCache';
import { getRegionContainingPoint } from '../regions/regionRepository';
import { isGeonamesReady, searchGlobalPlaces } from '../geocoding/globalGeocoderService';
import { getPersonalizationBoost } from './searchHistoryService';

// ---------------------------------------------------------------------------
// Source gating
// ---------------------------------------------------------------------------

/** Minimum strong local matches before named network sources are skipped. */
const SUFFICIENT_LOCAL_MATCHES = 8;
/** Radius (km) within which local matches count toward sufficiency. */
const LOCAL_MATCH_RADIUS_KM = 15;
/** Text-match score above which a local result counts as "strong". */
const STRONG_MATCH_THRESHOLD = 0.72;

/** Filter-sheet keys that differ from the canonical `PlaceCategory` value. */
const FILTER_CATEGORY_ALIASES: Partial<Record<string, PlaceCategory>> = {
  fuel: 'gas_station',
  gas: 'gas_station',
  ev: 'ev_charging',
  charging: 'ev_charging',
};

/**
 * Map user-selected category filter keys onto canonical place categories,
 * dropping anything unrecognized so a stale/free-form filter can't corrupt the
 * parsed intent.
 */
function normalizeFilterCategories(categories?: string[]): PlaceCategory[] {
  if (!categories || categories.length === 0) return [];
  const valid = new Set<string>(PLACE_CATEGORIES);
  const out: PlaceCategory[] = [];
  for (const raw of categories) {
    const key = raw.toLowerCase();
    const mapped =
      FILTER_CATEGORY_ALIASES[key] ?? (valid.has(key) ? (key as PlaceCategory) : undefined);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Count strong local matches around the reference point or user location. */
function countStrongLocalMatches(
  pois: OsmPoi[],
  parsed: ParsedSearchQuery,
  lat: number,
  lng: number,
  userLocation?: { lat: number; lng: number },
): number {
  const anchor = userLocation ?? { lat, lng };
  let count = 0;
  for (const poi of pois) {
    if (textMatchScore(poi, parsed) < STRONG_MATCH_THRESHOLD) continue;
    if (haversineKm(anchor.lat, anchor.lng, poi.lat, poi.lng) <= LOCAL_MATCH_RADIUS_KM) count++;
  }
  return count;
}

/** True when a downloaded offline region covers the point. */
async function hasOfflineRegionCoverage(lat: number, lng: number): Promise<boolean> {
  try {
    const region = await getRegionContainingPoint(lat, lng);
    return region?.downloadStatus === 'complete';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UnifiedSearchResult {
  /** Display name for the result. */
  name: string;
  /** Subtitle (address, city, category). */
  subtitle: string;
  /** Geographic coordinates. */
  lat: number;
  lng: number;
  /** Result type for icon selection. */
  type: 'poi' | 'address' | 'place';
  /** OSM-style type tag (amenity, shop, etc.) */
  osmType?: string;
  /** OSM-style subtype tag (restaurant, cafe, etc.) */
  osmSubtype?: string;
  /** Relevance score (0–100). */
  score: number;
  /** Distance from reference point in km. */
  distanceKm: number;
  /** Original POI data if available. */
  poi?: OsmPoi;
  /** Brand name if matched. */
  brand?: string;
  /** Number of matching branches nearby (brand queries only). */
  brandBranchCount?: number;
  /** Address city. */
  city?: string;
  /** Average community rating (0–5), when known. */
  rating?: number;
  /** Whether the place is currently open, when known. */
  openNow?: boolean;
  /** Price level (1–4), when known. */
  priceLevel?: number;
  /** Thumbnail image URL, when known. */
  thumbnailUrl?: string;
}

/** Result stages, emitted in this order as each completes. */
export type SearchStage = 'local' | 'cities' | 'photon' | 'category' | 'remaining';

export interface SearchStageMeta {
  stage: SearchStage;
  /** True for the last emission of the query. */
  final: boolean;
}

export interface SearchOptions {
  /** Viewport center latitude. */
  lat: number;
  /** Viewport center longitude. */
  lng: number;
  /** Current zoom level. */
  zoom: number;
  /** Maximum results to return. */
  limit?: number;
  /** Actual visible viewport bounds for in-viewport boosting. */
  viewportBounds?: { south: number; north: number; west: number; east: number };
  /** User's actual GPS location — when provided, Overture is also queried
   *  around this point so nearby places surface even if the map is panned away. */
  userLocation?: { lat: number; lng: number };
  /** Abort a stale in-flight search (e.g. superseded by a newer keystroke). */
  signal?: AbortSignal;
  /** Return local-DB results only — skip all network sources (Photon,
   *  Nominatim, Overpass, Overture). Resolves in milliseconds. */
  localOnly?: boolean;
  /** User-selected category filter keys (from the filter sheet). Folded into
   *  the parsed category intent so source gating and fetch radii stay coherent
   *  when only the filter (not the text) selects a category. */
  categories?: string[];
  /** Staged result callback: fires after each stage completes, with the
   *  accumulated, scored, deduplicated results so far. */
  onStage?: (results: UnifiedSearchResult[], meta: SearchStageMeta) => void;
  /** @deprecated Use `onStage` (stage `local`) instead. Called with scored
   *  local results as soon as the fast local phase completes, before the
   *  network phase finishes. Not called when `localOnly` is set. */
  onPartial?: (partial: UnifiedSearchResult[]) => void;
}

/**
 * Execute a unified search across all available sources.
 */
export async function unifiedSearch(
  query: string,
  options: SearchOptions,
): Promise<UnifiedSearchResult[]> {
  if (query.trim().length < 2) return [];

  const { lat, lng, zoom, limit = 30 } = options;

  // Category → OSM tag mapping for Photon filtering
  const CATEGORY_TO_OSM_TAG: Partial<Record<string, string>> = {
    cafe: 'amenity:cafe',
    restaurant: 'amenity:restaurant',
    fast_food: 'amenity:fast_food',
    bar: 'amenity:bar',
    pharmacy: 'amenity:pharmacy',
    hospital: 'amenity:hospital',
    fuel: 'amenity:fuel',
    parking: 'amenity:parking',
    supermarket: 'shop:supermarket',
    hotel: 'tourism:hotel',
    atm: 'amenity:atm',
    bank: 'amenity:bank',
    gym: 'leisure:fitness_centre',
  };

  // 1. Parse the query into structured intent
  const parsed = parseSearchQuery(query);

  // Fold user-selected category filters into the parsed intent so fetch radii
  // (`deriveQueryContext`), the local FTS fan-out, and source gating all agree
  // when the category comes from the filter sheet rather than the text.
  const filterCategories = normalizeFilterCategories(options.categories);
  if (filterCategories.length > 0) {
    parsed.categories = Array.from(new Set([...(parsed.categories ?? []), ...filterCategories]));
  }

  // Also check for fuzzy brand matches (handles typos like "starbuks")
  if (!parsed.brand) {
    const fuzzyBrand = fuzzyMatchBrand(query);
    if (fuzzyBrand) parsed.brand = fuzzyBrand;
  }

  // Detect address queries early — these need fundamentally different handling
  const addressQuery = isAddressQuery(query);

  const queryContext = deriveQueryContext(parsed, options);
  const south = lat - queryContext.viewportRadiusDeg;
  const north = lat + queryContext.viewportRadiusDeg;
  const west = lng - queryContext.viewportRadiusDeg;
  const east = lng + queryContext.viewportRadiusDeg;

  const userSouth = options.userLocation
    ? options.userLocation.lat - queryContext.userRadiusDeg
    : south;
  const userNorth = options.userLocation
    ? options.userLocation.lat + queryContext.userRadiusDeg
    : north;
  const userWest = options.userLocation
    ? options.userLocation.lng - queryContext.userRadiusDeg
    : west;
  const userEast = options.userLocation
    ? options.userLocation.lng + queryContext.userRadiusDeg
    : east;
  const hasUserLocation = !!options.userLocation;

  // 3a. Phase 1 — local sources only (milliseconds). Rendered via
  // onPartial so the UI feels instant while the network phase runs.
  const signal = options.signal;
  throwIfAborted(signal);

  // allSettled: an individual local-source failure (e.g. empty FTS table)
  // degrades to "no local results" rather than failing the whole search.
  // For category queries ("coffee"), fan FTS out across the core query plus
  // each category name so shops whose name lacks the query word
  // ("Babylon Bean", a cafe) still surface from the instant local pass.
  const ftsQueries =
    !addressQuery && parsed.categories
      ? Array.from(new Set([parsed.coreQuery, ...parsed.categories]))
      : [parsed.brand ?? parsed.coreQuery];
  const [localPlacesSettled, localCategorySettled, localAddressSettled] = await Promise.allSettled([
    // Source 1: Local FTS5 search (instant, offline)
    // Skip for address queries — FTS matches street names against POI names
    addressQuery
      ? Promise.resolve([])
      : (async () => {
          const batches = await Promise.all(
            ftsQueries.map((q) =>
              searchPlacesFts(q, south, west, north, east, limit).catch(() => [] as Place[]),
            ),
          );
          const seen = new Set<string>();
          const merged: Place[] = [];
          for (const batch of batches) {
            for (const p of batch) {
              if (seen.has(p.uuid)) continue;
              seen.add(p.uuid);
              merged.push(p);
            }
          }
          return merged.slice(0, limit);
        })(),

    // Source 2 (local part): Category search restricted to the local DB
    parsed.categories
      ? searchByCategory(parsed.originalQuery, south, west, north, east, limit, {
          signal,
          localOnly: true,
        })
      : Promise.resolve(null),

    // Source 4 (local part): Address geocoding restricted to the local DB
    // For address queries, always run with the original query (preserves commas/city/state)
    addressQuery
      ? searchAddress(parsed.originalQuery, 10, lat, lng, { signal, localOnly: true })
      : parsed.isNameSearch && !parsed.categories
        ? searchAddress(parsed.coreQuery, 10, lat, lng, { signal, localOnly: true })
        : Promise.resolve([] as GeocodingResult[]),
  ]);
  throwIfAborted(signal);

  const localPlaces = localPlacesSettled.status === 'fulfilled' ? localPlacesSettled.value : [];
  const localCategoryResult =
    localCategorySettled.status === 'fulfilled' ? localCategorySettled.value : null;
  const localAddressResults =
    localAddressSettled.status === 'fulfilled' ? localAddressSettled.value : [];

  // FTS places are reused by the full pass (phase 2 doesn't re-run FTS).
  // Local category POIs feed the partial pass only — phase 2 pushes the
  // full category result (local + network) instead, so no dedup is needed.
  const localPois = collectPlacePois(localPlaces);

  const partial = assembleResults({
    allPois: [...localPois, ...(localCategoryResult?.pois ?? [])],
    photonAddressResults: [],
    geocodingResults: localAddressResults,
    parsed,
    addressQuery,
    lat,
    lng,
    south,
    north,
    west,
    east,
    viewportBounds: options.viewportBounds,
    userLocation: options.userLocation,
    limit,
  });
  if (options.localOnly) return partial;
  options.onStage?.(partial, { stage: 'local', final: false });
  options.onPartial?.(partial);
  throwIfAborted(signal);

  // 3b. Phase 2 — network sources in parallel. Local category/address are
  // re-run without localOnly so their Overpass/Nominatim fallbacks execute.
  // For address queries, skip name-based POI sources that would match
  // street/city name fragments (e.g. "Knights of Columbus" for "columbus pkwy").
  //
  // Staged emission: results are emitted as stages complete
  // (local → photon → category → remaining) so fast sources never wait on
  // slow ones. The last emission is marked `final: true`.
  const allPois: OsmPoi[] = [...localPois];

  // Gate named network sources when the local phase already answers the query
  // confidently. Sparse areas still run every source (see specs/search-orchestration).
  const strongLocalMatches = countStrongLocalMatches(
    [...localPois, ...(localCategoryResult?.pois ?? [])],
    parsed,
    lat,
    lng,
    options.userLocation,
  );
  const skipCategoryFallback =
    !!parsed.categories && strongLocalMatches >= SUFFICIENT_LOCAL_MATCHES;
  const skipNameSearch = !!parsed.brand && strongLocalMatches >= SUFFICIENT_LOCAL_MATCHES;
  const gateOvertureFetch =
    strongLocalMatches >= SUFFICIENT_LOCAL_MATCHES && (!!parsed.categories || !!parsed.brand);
  const hasStructuredAddressHit =
    addressQuery &&
    localAddressResults.some((result) => {
      if (!result.entry.housenumber || !result.entry.street) return false;
      return normalizeSearchText(query)
        .toLowerCase()
        .includes(result.entry.housenumber.toLowerCase());
    });
  const photonAddressResults: UnifiedSearchResult[] = [];
  let addressEntries: GeocodingResult[] = [];
  let finalResults: UnifiedSearchResult[] | null = null;

  const activeSources = new Set<string>();
  const pendingSources = new Set<string>();
  let photonEmitted = false;
  let categoryEmitted = false;

  const assemble = () =>
    assembleResults({
      allPois,
      photonAddressResults,
      geocodingResults: addressEntries,
      parsed,
      addressQuery,
      lat,
      lng,
      south,
      north,
      west,
      east,
      viewportBounds: options.viewportBounds,
      userLocation: options.userLocation,
      limit,
    });

  const emitStage = (stage: SearchStage, final: boolean): UnifiedSearchResult[] => {
    const results = assemble();
    if (final) finalResults = results;
    if (!signal?.aborted) options.onStage?.(results, { stage, final });
    return results;
  };

  const maybeEmitStages = () => {
    if (signal?.aborted) return;
    const photonReady = !activeSources.has('photon') || !pendingSources.has('photon');
    const categoryReady = !activeSources.has('category') || !pendingSources.has('category');

    if (activeSources.has('photon') && photonReady && !photonEmitted) {
      photonEmitted = true;
      emitStage('photon', false);
    }
    if (activeSources.has('category') && photonReady && categoryReady && !categoryEmitted) {
      categoryEmitted = true;
      emitStage('category', false);
    }
    if (pendingSources.size === 0 && photonReady && categoryReady && finalResults === null) {
      emitStage('remaining', true);
    }
  };

  function tracked<T>(name: string, promise: Promise<T>, apply: (value: T) => void): Promise<T> {
    activeSources.add(name);
    pendingSources.add(name);
    return promise
      .then((value) => {
        apply(value);
        return value;
      })
      .finally(() => {
        pendingSources.delete(name);
        maybeEmitStages();
      });
  }

  // Cities stage — offline GeoNames cities resolve in milliseconds, so they
  // are emitted before any network source completes.
  if (!addressQuery && isGeonamesReady()) {
    try {
      const cities = await searchGlobalPlaces(parsed.coreQuery, lat, lng, 10);
      if (cities.length > 0 && !signal?.aborted) {
        for (const city of cities) {
          allPois.push({
            id: -Math.abs(city.geonameId),
            lat: city.lat,
            lng: city.lng,
            name: city.name,
            type: 'place',
            subtype: 'city',
            tags: {
              name: city.name,
              place: 'city',
              'addr:city': city.name,
              ...(city.countryCode ? { 'addr:country': city.countryCode } : {}),
              'polaris:population': String(city.population),
            },
          });
        }
        emitStage('cities', false);
      }
    } catch {
      // Missing/corrupt GeoNames DB degrades to no city results.
    }
  }

  // Collect Photon results — include all named results in scoring, not just
  // strict POI osm_keys. Places like outlet malls may have osm_key 'building'
  // but are still findable named destinations.
  // When the query matches a known category (e.g. "deli"), filter out
  // street/road results to prevent "Delile Place" from outranking actual delis.
  // For address queries, house/street results go through the address pipeline.
  const applyPhotonResults = (results: PhotonResult[]) => {
    for (const pr of results) {
      if (!pr.poi.name) continue;

      // For address queries, Photon is restricted to house+street layers.
      // Route ALL results (houses, streets, addresses) to the address
      // pipeline regardless of isPoi classification — the layer restriction
      // guarantees that only address-related features are returned, and
      // classifying them as POIs would pollute the POI scoring with street
      // names that happen to share keywords with the query.
      if (addressQuery) {
        photonAddressResults.push({
          name: pr.displayText || pr.poi.name,
          subtitle: [pr.address.city, pr.address.state, pr.address.country]
            .filter(Boolean)
            .join(', '),
          lat: pr.poi.lat,
          lng: pr.poi.lng,
          type: 'address',
          score: 90,
          distanceKm: 0,
        });
        continue;
      }

      // Exclude roads/streets — their fuzzy name match pollutes results
      // for any non-address query (e.g. "Marshall Avenue" for "marshalls",
      // "Delisle Avenue" for "deli"). Address queries go through the
      // dedicated address pipeline above.
      //
      // Exception: when Photon returns a non-POI result whose name closely
      // matches the query (e.g. "1000 Broadway"), promote it as an address
      // result instead of discarding it. This handles addresses that the
      // isAddressQuery heuristic missed (e.g. where the street suffix is
      // embedded in the street name rather than a standalone token).
      if (isStreetResult(pr)) {
        const qLower = normalizeSearchText(query).toLowerCase();
        const nameLower = normalizeSearchText(pr.poi.name).toLowerCase();
        const housenumber = pr.address.housenumber ?? '';
        const queryContainsHousenumber =
          !!housenumber && qLower.includes(housenumber.toLowerCase());
        const nameStronglyMatches =
          qLower.includes(nameLower) || nameLower.includes(qLower) || queryContainsHousenumber;
        if (nameStronglyMatches && !parsed.categories) {
          photonAddressResults.push({
            name: pr.displayText || pr.poi.name,
            subtitle: [pr.address.city, pr.address.state, pr.address.country]
              .filter(Boolean)
              .join(', '),
            lat: pr.poi.lat,
            lng: pr.poi.lng,
            type: 'address',
            score: 75,
            distanceKm: 0,
          });
        }
        continue;
      }
      allPois.push(pr.poi);
    }
  };

  const applyCategoryResult = (value: CategorySearchResult | null) => {
    if (!value) return;
    for (const poi of value.pois) {
      allPois.push(poi);
    }
  };

  // Source 3: Photon geocoder (fuzzy, online)
  const photonPromise = (() => {
    const osmTagFilter =
      parsed.categories?.length === 1
        ? (CATEGORY_TO_OSM_TAG[parsed.categories[0]] ?? undefined)
        : undefined;
    // Pass the actual viewport zoom so Photon's location bias stays local.
    // Photon already ranks globally-unique names ("Times Square") correctly
    // even at a high zoom, so lowering it is unnecessary — and harmful, since
    // it floods generic local queries ("plumbing supply") with distant
    // matches that outrank the nearby ones.
    const viewportBounds = { south, north, west, east };
    return cachedFetch(
      cacheKey([
        'photon',
        parsed.originalQuery,
        boundsKey(viewportBounds),
        zoom,
        limit,
        osmTagFilter,
      ]),
      () =>
        searchPhoton(parsed.originalQuery, lat, lng, zoom, limit, 'en', osmTagFilter, {
          signal,
        }),
      { bounds: viewportBounds },
    );
  })();

  // Source 2 (full): Category search (local + Overpass + Nominatim bounded)
  const categoryPromise: Promise<CategorySearchResult | null> = !parsed.categories
    ? Promise.resolve(null)
    : skipCategoryFallback
      ? // Sufficient local matches — reuse the local category pass, skip Overpass.
        Promise.resolve(localCategoryResult)
      : cachedFetch(
          cacheKey([
            'category',
            parsed.originalQuery,
            boundsKey({ south, north, west, east }),
            limit,
          ]),
          () => searchByCategory(parsed.originalQuery, south, west, north, east, limit, { signal }),
          { bounds: { south, north, west, east } },
        );

  // Source 4 (full): Address geocoding (local FTS + Nominatim)
  const isAddressPass = addressQuery || (parsed.isNameSearch && !parsed.categories);
  const addressQueryText = addressQuery ? parsed.originalQuery : parsed.coreQuery;
  const addressPromise: Promise<GeocodingResult[]> = (() => {
    if (!isAddressPass) return Promise.resolve([] as GeocodingResult[]);
    // An exact structured local hit skips the Nominatim fallback entirely.
    if (hasStructuredAddressHit) {
      return searchAddress(addressQueryText, 10, lat, lng, { signal, localOnly: true });
    }
    const viewportBounds = { south, north, west, east };
    return cachedFetch(
      cacheKey([
        'address',
        addressQueryText,
        boundsKey(viewportBounds),
        lat.toFixed(2),
        lng.toFixed(2),
      ]),
      () => searchAddress(addressQueryText, 10, lat, lng, { signal }),
      { bounds: viewportBounds },
    );
  })();

  // Source 5: Online Overture fetch — populates local DB and returns fresh places
  // Skip for address queries — same name-matching pollution as Source 1
  const overturePromise: Promise<Place[]> = addressQuery
    ? Promise.resolve([])
    : (async () => {
        // With enough strong local matches and a downloaded region covering
        // the point, local data is authoritative — skip the network fetch.
        if (gateOvertureFetch && (await hasOfflineRegionCoverage(lat, lng))) return [];
        return cachedFetch(
          cacheKey([
            'overture',
            boundsKey({ south, north, west, east }),
            queryContext.viewportFetchLimit,
          ]),
          () =>
            fetchOverturePlaces(south, west, north, east, queryContext.viewportFetchLimit, {
              signal,
            }),
          { bounds: { south, north, west, east } },
        );
      })();

  // Source 5b: User-location-centered Overture fetch (~10 km radius)
  // Ensures nearby places surface even when the map has been panned away.
  const overtureUserPromise: Promise<Place[]> =
    !hasUserLocation || addressQuery
      ? Promise.resolve([])
      : cachedFetch(
          cacheKey([
            'overture-user',
            boundsKey({ south: userSouth, north: userNorth, west: userWest, east: userEast }),
            queryContext.userFetchLimit,
          ]),
          () =>
            fetchOverturePlaces(
              userSouth,
              userWest,
              userNorth,
              userEast,
              queryContext.userFetchLimit,
              { signal },
            ),
          { bounds: { south: userSouth, north: userNorth, west: userWest, east: userEast } },
        );

  // Source 6: Overpass name search — finds POIs with the search term in their name
  // Skip for address queries — catches "Knights of Columbus" for "columbus pkwy"
  const osmNamePromise: Promise<OsmPoi[]> =
    addressQuery || skipNameSearch
      ? Promise.resolve([])
      : cachedFetch(
          cacheKey(['osm-name', parsed.coreQuery, boundsKey({ south, north, west, east }), limit]),
          () => fetchOsmPoisByName(south, west, north, east, parsed.coreQuery, { signal }),
          { bounds: { south, north, west, east } },
        );

  const sources: Promise<unknown>[] = [
    tracked('photon', photonPromise, applyPhotonResults),
    parsed.categories ? tracked('category', categoryPromise, applyCategoryResult) : categoryPromise,
    isAddressPass
      ? tracked('address', addressPromise, (value) => {
          addressEntries = value;
        })
      : addressPromise,
    addressQuery
      ? overturePromise
      : tracked('overture', overturePromise, (value) => {
          allPois.push(...collectPlacePois(value));
        }),
    !hasUserLocation || addressQuery
      ? overtureUserPromise
      : tracked('overtureUser', overtureUserPromise, (value) => {
          allPois.push(...collectPlacePois(value));
        }),
    addressQuery
      ? osmNamePromise
      : tracked('osmName', osmNamePromise, (value) => {
          for (const poi of value) allPois.push(poi);
        }),
  ];

  maybeEmitStages();
  await Promise.allSettled(sources);
  throwIfAborted(signal);

  return finalResults ?? emitStage('remaining', true);
}

// ---------------------------------------------------------------------------
// Result assembly — shared by the fast local partial pass and the full pass
// ---------------------------------------------------------------------------

interface AssembleInput {
  allPois: OsmPoi[];
  photonAddressResults: UnifiedSearchResult[];
  geocodingResults: GeocodingResult[];
  parsed: ParsedSearchQuery;
  addressQuery: boolean;
  lat: number;
  lng: number;
  south: number;
  north: number;
  west: number;
  east: number;
  viewportBounds?: SearchOptions['viewportBounds'];
  userLocation?: { lat: number; lng: number };
  limit: number;
}

/** Convert Overture/Place rows to OsmPoi, carrying brand/rating tags for scoring. */
function collectPlacePois(places: Place[]): OsmPoi[] {
  return places.map((place) => {
    const poi = placeToOsmPoi(place);
    if (place.brandName) poi.tags['polaris:brand'] = place.brandName;
    if (place.avgRating) poi.tags['polaris:avg_rating'] = String(place.avgRating);
    if (place.reviewCount) poi.tags['polaris:review_count'] = String(place.reviewCount);
    const ftsRelevance = (place as Place & { ftsRelevance?: number }).ftsRelevance;
    if (ftsRelevance != null) poi.tags['polaris:fts'] = String(ftsRelevance);
    return poi;
  });
}

function assembleResults(input: AssembleInput): UnifiedSearchResult[] {
  const {
    allPois,
    photonAddressResults,
    geocodingResults,
    parsed,
    addressQuery,
    lat,
    lng,
    south,
    north,
    west,
    east,
    viewportBounds,
    userLocation,
    limit,
  } = input;

  const density = inferQueryDensity(allPois, parsed, lat, lng, userLocation);
  const proximityAnchor = resolveProximityAnchor(parsed, { userLocation }, density);

  // 4. Score and rank all POI results (with dynamic proximity + viewport boost)
  const vpRect = viewportBounds ?? { south, north, west, east };
  let scored = scoreAndRank(allPois, parsed, lat, lng, {
    viewport: vpRect,
    userLocation,
    proximityAnchor,
    locationSensitivityKm: locationSensitivityKmFor(parsed, density, proximityAnchor),
    queryDensity: density,
    inViewportProximityFloor: parsed.isNameSearch && density !== 'sparse' ? 0.92 : 0.82,
  });
  scored = deduplicateResults(scored);
  if (userLocation && !addressQuery && proximityAnchor !== 'viewport') {
    scored = promoteNearbyUserMatches(scored, parsed, userLocation);
  }

  // Personalization: bounded boost for results the user has selected before.
  if (parsed.originalQuery.trim().length >= 2) {
    scored = scored
      .map((result) => {
        const boost = getPersonalizationBoost(parsed.originalQuery, result.poi.name);
        return boost > 0 ? { ...result, score: Math.min(100, result.score + boost) } : result;
      })
      .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
  }

  // Brand queries: order branches nearest-first and attach a branch count so
  // the UI can group multiple locations of the same brand.
  let brandBranchCount: number | undefined;
  if (parsed.brand) {
    const brandLower = normalizeSearchText(parsed.brand).toLowerCase();
    const isBranch = (poi: OsmPoi) => {
      const name = normalizeSearchText(poi.name).toLowerCase();
      const tag = normalizeSearchText(
        poi.tags['polaris:brand'] ?? poi.tags['brand'] ?? '',
      ).toLowerCase();
      return name.includes(brandLower) || tag.includes(brandLower);
    };
    brandBranchCount = scored.filter((result) => isBranch(result.poi)).length;
    scored = [...scored].sort((a, b) => {
      const aBranch = isBranch(a.poi);
      const bBranch = isBranch(b.poi);
      if (aBranch && bBranch) return a.distanceKm - b.distanceKm || b.score - a.score;
      if (aBranch !== bBranch) return aBranch ? -1 : 1;
      return b.score - a.score || a.distanceKm - b.distanceKm;
    });
  }

  // 5. Build geocoding (address) results — from Nominatim + Photon house/street
  const addressResults: UnifiedSearchResult[] = [...photonAddressResults];
  for (const gr of geocodingResults) {
    // Skip if already covered by a Photon address result nearby
    const isDup = addressResults.some(
      (ar) => Math.abs(ar.lat - gr.entry.lat) < 0.0003 && Math.abs(ar.lng - gr.entry.lng) < 0.0003,
    );
    if (!isDup) {
      addressResults.push({
        name: gr.entry.text,
        subtitle: [gr.entry.city, gr.entry.state, gr.entry.country].filter(Boolean).join(', '),
        lat: gr.entry.lat,
        lng: gr.entry.lng,
        type: 'address',
        score: addressQuery ? 95 : 50,
        distanceKm: 0,
      });
    }
  }

  // 6. Convert POI results
  const poiLimit = addressQuery ? Math.max(5, limit - addressResults.length) : limit;
  const poiResults: UnifiedSearchResult[] = scored.slice(0, poiLimit).map((sr) => ({
    name: sr.poi.name,
    subtitle: buildSubtitle(sr.poi),
    lat: sr.poi.lat,
    lng: sr.poi.lng,
    type: 'poi',
    osmType: sr.poi.type,
    osmSubtype: sr.poi.subtype,
    score: sr.score,
    distanceKm: sr.distanceKm,
    poi: sr.poi,
    brand: parsed.brand ?? undefined,
    brandBranchCount,
    city: sr.poi.tags['addr:city'],
  }));

  // 7. Merge: when address query, geocoding results come first; otherwise append
  let results: UnifiedSearchResult[];
  if (addressQuery && addressResults.length > 0) {
    // Deduplicate: skip address results already covered by a nearby POI
    const dedupedAddresses = addressResults.filter(
      (ar) =>
        !poiResults.some(
          (r) => Math.abs(r.lat - ar.lat) < 0.0003 && Math.abs(r.lng - ar.lng) < 0.0003,
        ),
    );
    results = [...dedupedAddresses, ...poiResults].slice(0, limit);
  } else {
    results = [...poiResults];
    const remaining = limit - results.length;
    if (remaining > 0) {
      for (const ar of addressResults.slice(0, remaining)) {
        const isDup = results.some(
          (r) => Math.abs(r.lat - ar.lat) < 0.0003 && Math.abs(r.lng - ar.lng) < 0.0003,
        );
        if (!isDup) results.push(ar);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSubtitle(poi: OsmPoi): string {
  const parts: string[] = [];

  // Subtype label (e.g. "Restaurant", "Cafe")
  if (poi.subtype && poi.subtype !== 'place' && poi.subtype !== 'yes') {
    parts.push(formatSubtype(poi.subtype));
  }

  // Street address
  const street = poi.tags['addr:street'];
  const number = poi.tags['addr:housenumber'];
  if (number && street) {
    parts.push(`${number} ${street}`);
  } else if (street) {
    parts.push(street);
  }

  // City
  const city = poi.tags['addr:city'];
  if (city) parts.push(city);

  return parts.join(' · ');
}

function formatSubtype(subtype: string): string {
  return subtype.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Photon osm_key values that represent streets/roads/addresses, not POIs. */
const STREET_OSM_KEYS = new Set(['highway', 'place', 'boundary', 'waterway', 'natural', 'landuse']);
const STREET_TYPES = new Set(['street', 'district', 'locality', 'city', 'county', 'state']);

/**
 * Returns true if a Photon result represents a street/road/area
 * rather than a POI. Used to filter out "Delisle Avenue"-type results
 * when the user is searching for a category like "deli".
 */
function isStreetResult(pr: { poi: OsmPoi; isPoi: boolean }): boolean {
  if (pr.isPoi) return false;
  if (STREET_OSM_KEYS.has(pr.poi.type)) return true;
  // Photon sometimes has 'type' in tags
  const photonType = pr.poi.tags['type'] ?? '';
  if (STREET_TYPES.has(photonType)) return true;
  return false;
}

function promoteNearbyUserMatches(
  results: ScoredResult[],
  parsed: ParsedSearchQuery,
  userLocation: { lat: number; lng: number },
): ScoredResult[] {
  const normalizedQuery = normalizeSearchText(parsed.brand ?? parsed.coreQuery).toLowerCase();
  if (!normalizedQuery) return results;

  return [...results]
    .map((result) => {
      const name = normalizeSearchText(result.poi.name).toLowerCase();
      const brand = normalizeSearchText(
        result.poi.tags['polaris:brand'] ?? result.poi.tags['brand'] ?? '',
      ).toLowerCase();
      const isStrongMatch =
        name === normalizedQuery ||
        brand === normalizedQuery ||
        name.startsWith(normalizedQuery) ||
        name.includes(normalizedQuery) ||
        brand.includes(normalizedQuery);
      if (!isStrongMatch) return result;

      const userDistanceKm = haversineKm(
        userLocation.lat,
        userLocation.lng,
        result.poi.lat,
        result.poi.lng,
      );
      if (userDistanceKm > 25) return result;

      const boost = Math.max(0, 18 - userDistanceKm * 1.2);
      return { ...result, score: result.score + boost };
    })
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
}

function deriveQueryContext(
  parsed: ParsedSearchQuery,
  options: SearchOptions,
): {
  viewportRadiusDeg: number;
  userRadiusDeg: number;
  viewportFetchLimit: number;
  userFetchLimit: number;
} {
  const zoomRadiusDeg = Math.max(0.035, Math.min(1.4, (360 / Math.pow(2, options.zoom)) * 1.5));

  if (parsed.categories || parsed.cuisineHint) {
    return {
      viewportRadiusDeg: Math.max(zoomRadiusDeg, 0.09),
      userRadiusDeg: parsed.wantsNearMe ? 0.1 : 0.08,
      viewportFetchLimit: 420,
      userFetchLimit: 180,
    };
  }

  if (parsed.brand || parsed.isNameSearch) {
    return {
      // Allow a wider search radius for name-based queries so that
      // well-known destinations (e.g. "Times Square" in Manhattan from
      // Levittown, ~40 km away) are included in the fetch area.
      // Cap at 0.45° (~50 km) instead of the previous 0.22° (~24 km).
      viewportRadiusDeg: Math.min(Math.max(zoomRadiusDeg, 0.08), 0.45),
      userRadiusDeg: parsed.wantsNearMe ? 0.14 : 0.1,
      viewportFetchLimit: 260,
      userFetchLimit: 120,
    };
  }

  return {
    viewportRadiusDeg: zoomRadiusDeg,
    userRadiusDeg: 0.09,
    viewportFetchLimit: 320,
    userFetchLimit: 140,
  };
}

function inferQueryDensity(
  pois: OsmPoi[],
  parsed: ParsedSearchQuery,
  lat: number,
  lng: number,
  userLocation?: { lat: number; lng: number },
): 'dense' | 'normal' | 'sparse' {
  const anchor = userLocation ?? { lat, lng };
  let strongMatchesWithin5Km = 0;
  let strongMatchesWithin15Km = 0;

  for (const poi of pois) {
    const match = textMatchScore(poi, parsed);
    if (match < 0.72) continue;
    const dist = haversineKm(anchor.lat, anchor.lng, poi.lat, poi.lng);
    if (dist <= 5) strongMatchesWithin5Km++;
    if (dist <= 15) strongMatchesWithin15Km++;
  }

  if (strongMatchesWithin5Km >= 4 || strongMatchesWithin15Km >= 8) return 'dense';
  if (strongMatchesWithin15Km <= 1) return 'sparse';
  return 'normal';
}

function resolveProximityAnchor(
  parsed: ParsedSearchQuery,
  options: Pick<SearchOptions, 'userLocation'>,
  density: 'dense' | 'normal' | 'sparse',
): 'viewport' | 'user' | 'mixed' {
  if (!options.userLocation) return 'viewport';
  if (parsed.wantsNearMe) return 'user';
  if (parsed.categories || parsed.cuisineHint) return 'viewport';
  if (parsed.brand || parsed.isNameSearch) {
    return density === 'dense' ? 'mixed' : 'viewport';
  }
  return 'mixed';
}

function locationSensitivityKmFor(
  parsed: ParsedSearchQuery,
  density: 'dense' | 'normal' | 'sparse',
  anchor: 'viewport' | 'user' | 'mixed',
): number {
  if (anchor === 'user') {
    if (density === 'dense') return 4;
    if (density === 'sparse') return 14;
    return 7;
  }

  if (parsed.brand || parsed.isNameSearch) {
    if (density === 'dense') return 3.5;
    if (density === 'sparse') return 18;
    return 7;
  }

  if (parsed.categories || parsed.cuisineHint) {
    if (density === 'dense') return 5;
    if (density === 'sparse') return 16;
    return 9;
  }

  return density === 'sparse' ? 15 : 8;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Re-export for convenience
export type { ParsedSearchQuery, ScoredResult };
