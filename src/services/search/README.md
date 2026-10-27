# Geocoding & Search

Unified search pipeline combining local FTS5, offline GeoNames cities, Photon geocoding, Overpass category/name search, Nominatim address geocoding, and Overture places. Results are emitted in stages, cached, deduplicated, and relevance-ranked.

## Overview

Search is a staged multi-source pipeline:

1. **Query parser** extracts intent — brand names, cuisine hints, modifiers ("near me", "open now", "best", "cheap"), and resolved POI categories
2. **Staged emission** delivers results as each source stage completes: `local` → `cities` → `photon` → `category` → `remaining` (final)
3. **Sources**
   - Local FTS5 over Overture places (weighted bm25: name ≫ brand ≫ category ≫ city)
   - Offline GeoNames cities1000 (~140k cities) for instant city results
   - Photon (Komoot) for fuzzy, typo-tolerant address/POI search
   - Overpass for category POIs and, as a **gap-filler**, name matches: Overpass is
     routinely congested (HTTP 406/403 from every mirror), so Photon + Overture +
     MapKit are load-bearing for name search and Overpass runs only after they
     settle — and only when their candidates leave the query thin (≤1 strong
     match within 15 km of the camera)
   - Nominatim for structured address geocoding (shared 1 req/s throttle)
   - Overture PMTiles for viewport/user-location place freshness
   - Apple MapKit nearby POIs (iOS) for commercial place coverage that open data lacks
4. **Result cache** (LRU + TTL) serves repeated/concurrent queries without re-hitting the network; local writes invalidate overlapping areas
5. **Ranker v2** scores 0–100 using bm25 + text match, distance, category, popularity, viewport, active intent modifiers, and bounded personalization
6. **Query plan** (`queryPlan.ts`) owns the cross-layer result-governance policy: the area a query is answered in (75 km), the panel's distant-tail/pin/fit radii, and the intent classification (address / nearby / named-place) that decides camera framing. The engine and the floating panel read the same object instead of separate copies.
7. **Search history** persists the last 10 selections (with their query) in MMKV and drives the personalization boost

## Locality rules

- A search answers **where the user is looking**. Candidates farther than 75 km from the camera (or the user's GPS fix) are dropped for local-intent queries. Text-first sources (Photon, Nominatim) rank on text and only bias by location, so without this gate a Manhattan search is answered by a Boston café 300 km away.
- Explicit destinations bypass the area gate: a structured address query, a city result, or a query whose **last token is a known city** ("tatte boston"). That is a request to go there.
- Category boxes are capped at ~0.25° (~28 km): a zoomed-out map must not turn "bagels" into a continental Overpass query.
- Category candidates are anchored (user location, else map centre) and truncated **nearest-first** before ranking — Overpass returns features in arbitrary geographic order, so slicing first would let a dense far-away cluster bury nearby places.
- On an explicit submit only a place/brand/address lookup may frame a distant match. Nearby-intent queries (category/cuisine/"near me") keep the camera where the user is when every match is > 20 km away; the list stays authoritative.
- The floating panel applies the same rule to its merged rows (stations, ranked hits): distant non-destination rows are dropped, and an empty local list shows "no places nearby" instead of another metro's matches.

## Failure handling (failure ≠ empty)

- A source that **throws** (Photon timeout/HTTP error, Overpass outage, Overture archive
  unavailable, MapKit native error) stays _uncached_: the orchestrator absorbs the rejection
  via `Promise.allSettled`, the remaining sources still answer, and the next keystroke
  retries the network. Warn-log the failure (`[search] source "<name>" failed`) so an
  incomplete list always has a visible cause.
- A source that **resolves `[]`** is an honest "zero results" and is negative-cached for
  60 s — only reachable once sources no longer swallow errors into empty results
  (see `photonGeocoder.ts`, `mapKitPlaceSource.ts`, `overtureFetcher.ts`).
- Overpass is hedged across three mirrors but is routinely unavailable; Photon
  (osm-tag POIs), Overture (commercial-grade place coverage) and MapKit (iOS POI
  search) carry name/brand searches when it is down.

## Architecture

```
User query
    ↓
queryParser.ts → { categories, brand, cuisine, modifiers }
    ↓
unifiedSearch.ts — staged emission
    │
    ├─ local stage  ── searchPlacesFts (bm25) + category (local) + address (local)
    ├─ cities stage ── globalGeocoderService (offline GeoNames)
    │                  [cachedFetch: Photon | category+Overpass | address+Nominatim | Overture ×2 | MapKit | Overpass name (gap-filler)]
    ├─ photon stage
    ├─ category stage
    └─ remaining (final) stage
    ↓
Deduplication (canonical id → fuzzy spatial) + ranking (searchRanker.ts)
    ↓
Area-of-interest gate (75 km via queryPlan unless the query names a destination)
    ↓
SearchResults component  ←  usePlaceSearch (debounce/abort/staged updates)
    ↓
searchHistoryService.ts → MMKV (last 10, query + selection)
```

All UI consumers (search tab, floating search panel, add-stop search, add destination, CarPlay) use the shared session (`createSearchSession` / `usePlaceSearch`) so debounce, abort-on-new-input, and staged updates behave identically.

## Files

### Search (`src/services/search/`)

| File                      | Description                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unifiedSearch.ts`        | Top-level orchestrator — runs sources in parallel, emits stages, gates named sources on local sufficiency, runs the Overpass name-search **gap-filler** after primaries settle, applies the area-of-interest gate, merges/caches/deduplicates/ranks. Entry point for all search. |
| `mapKitPlaceSource.ts`    | Apple MapKit (`MKLocalSearch`) nearby POIs adapted to `OsmPoi` — commercial place coverage for iOS, empty elsewhere.                                                                                                                                                             |
| `queryPlan.ts`            | Shared result-governance policy owned in one place: intent classification (address / nearby / named-place), the 75 km area gate, the panel's tail/pin/fit radii, and distant-framing permission.                                                                                 |
| `searchSession.ts`        | Non-React session: debounce, abort lifecycle, local-first pass, generation checks, optional coordinate pre-flight.                                                                                                                                                               |
| `searchCache.ts`          | Bounded LRU result cache: per-source TTLs (5 min results / 60 s empty), quantized-bbox keys, in-flight dedupe, bbox invalidation.                                                                                                                                                |
| `queryParser.ts`          | Parses natural-language queries into structured intent (brand, cuisine, modifiers, categories, address heuristics).                                                                                                                                                              |
| `searchRanker.ts`         | Scores results 0–100: bm25 + text match, distance, category, popularity, viewport, intent modifiers (open now / quality / cheap), canonical dedup.                                                                                                                               |
| `searchFilters.ts`        | Pure filter/sort view layer over ranked results: open-now, min rating, max price, max distance, categories; sorts by relevance/distance/rating/price; intent-seeded defaults with explicit override (unknown data passes through).                                               |
| `searchSession.ts`        | Keystroke lifecycle (debounce/abort/local-first). Reads `getCategoryFilters` at search time so a category-filter change is folded into the parsed intent and re-gates sources; non-category filters just re-apply locally.                                                       |
| `openingHours.ts`         | Minimal `parseOpenNow` for common OSM hours syntax; returns null (unknown) when unparseable.                                                                                                                                                                                     |
| `photonGeocoder.ts`       | Komoot Photon API client — fuzzy, typo-tolerant OSM-based geocoding.                                                                                                                                                                                                             |
| `requestThrottle.ts`      | Shared abort-aware request throttles (Nominatim 1 req/s across all call sites).                                                                                                                                                                                                  |
| `searchHistoryService.ts` | MMKV-persisted last 10 selections (query + result); personalization boost lookups.                                                                                                                                                                                               |
| `abortUtils.ts`           | Abort helpers (`throwIfAborted`, `sleepWithAbort`, `withTimeout`, `withSourceTimeout`).                                                                                                                                                                                          |

### Geocoding (`src/services/geocoding/`)

| File                           | Description                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `geocodingService.ts`          | Local structured/free-text geocoding with distance ranking + trigram typo fallback, then Nominatim (rate-limited, 8 s timeout). |
| `globalGeocoderService.ts`     | Offline GeoNames cities1000 geocoder (download, FTS5 + population + proximity ranking).                                         |
| `geonamesDownloadScheduler.ts` | Opportunistic Wi-Fi-preferred download on first online idle; silent no-op when no URL is configured.                            |

### Indexes (`src/services/database/init.ts`)

- `places_fts` — external-content FTS5 with `prefix='2 3 4'` and unicode61 diacritics stripping; maintained incrementally by Overture upserts (no full rebuild on the search path), with a row-count consistency fallback.
- `geocoding_entries` — FTS5 over structured address columns; supports column filters (`{street}:"main"*`).
- `geocoding_trigram` — trigram FTS5 for offline typo/substring street/locality matching.

## Key Constants

| Constant                       | Value   | Description                                         |
| ------------------------------ | ------- | --------------------------------------------------- |
| `NOMINATIM_MIN_INTERVAL_MS`    | 1,000   | Shared minimum gap between Nominatim requests       |
| `SEARCH_CACHE_TTL_MS`          | 300,000 | Result cache TTL (non-empty results)                |
| `SEARCH_CACHE_NEGATIVE_TTL_MS` | 60,000  | Negative cache TTL (empty results)                  |
| `SUFFICIENT_LOCAL_MATCHES`     | 8       | Strong local matches before named sources are gated |
| `SEARCH_AREA_RADIUS_KM`        | 75      | Area that answers a local-intent query (km)         |
| `PERSONALIZATION_BOOST`        | 5       | Bounded boost for previously selected results       |
| `MAX_HISTORY`                  | 10      | Maximum saved search history entries                |

## Benchmarks & Evaluation

- `pnpm search:bench [--rows=100000] [--places-fts=baseline|v2] [--trigram=on|off]` — synthetic SQLite benchmark for FTS queries, structured/trigram lookups, and incremental-vs-rebuild maintenance. JSON on stdout, human summary on stderr.
- `__tests__/unit/searchEval.test.ts` — ≥30 realistic queries with expected top-3 results (recall@3 / NDCG@3 gates).
- `__tests__/unit/searchSession.test.ts`, `searchOrchestration.test.ts`, `searchCache*.test.ts`, `localSearchIndex.test.ts`, `overtureUpsertFts.test.ts` — lifecycle, staged emission, cache, index, and FTS-maintenance coverage.

## Related Files

- [`src/components/search/`](../../components/search/) — SearchBar, SearchResults, and SearchHistory UI
- [`src/hooks/usePlaceSearch.ts`](../../hooks/usePlaceSearch.ts) — React wrapper around the search session
- [`src/services/poi/categorySearchService.ts`](../poi/categorySearchService.ts) — Category search with Overpass fallback
- [`src/services/poi/categoryResolver.ts`](../poi/categoryResolver.ts) — Natural-language → PlaceCategory mapping
- [`app/(tabs)/search.tsx`](<../../../app/(tabs)/search.tsx>) — Search tab with coordinate/Plus Code detection
