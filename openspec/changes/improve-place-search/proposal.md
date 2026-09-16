# Improve Place Search — Faster and Smarter

## Why

Place search is the primary way users pick destinations, but today the UI waits on the slowest network source before showing the final list: `unifiedSearch` emits only a local partial and then awaits `Promise.allSettled` over Photon, Overpass (15s timeout), Nominatim (1s throttle), and Overture PMTiles fetches. Every Overture fetch ends with a full FTS5 `rebuild` over the entire `places` table on the shared SQLite connection, and there is no result cache anywhere in the search path. At the same time, fast local assets are underused — the offline GeoNames city database is implemented but never downloaded or queried — and parsed intent (`open now`, `quality`, `cheap`) never influences results. The result is search that feels slow and returns less relevant rankings than competing map apps.

## What Changes

- **Progressive result emission**: stream scored results after each source stage (local → offline cities → Photon → category → remaining) instead of one final merge after all network sources settle; keep ordering stable as new stages arrive.
- **Result caching**: LRU + TTL cache and in-flight request dedupe keyed by normalized query, bbox bucket, and options; negative caching for empty network results.
- **Incremental FTS maintenance**: replace the per-fetch `INSERT INTO places_fts(places_fts) VALUES('rebuild')` with transactional incremental FTS writes; reserve `rebuild`/`optimize` for region import and idle maintenance.
- **Source gating**: skip Overpass name search, Overture fetches, and Nominatim fallbacks when the local/offline phase already yields sufficient, high-confidence matches.
- **Wire the offline GeoNames geocoder**: download on first run and query in the fast phase for instant city-level results (`globalGeocoderService` currently has zero callers).
- **Shared search hook**: one `usePlaceSearch` implementation of debounce/abort/two-phase/partial behavior adopted by all consumers (search tab, FloatingSearchPanel both paths, AddDestinationPanel, CarPlay); fixes the no-debounce/no-abort stop-search path.
- **Local index upgrades**: FTS5 prefix indexes and `bm25()` column weights; structured address parsing with an indexed column query and distance-ranked local geocoding; local typo tolerance via a trigram FTS table.
- **Smarter ranking**: activate `wantsOpenNow` / `wantsQuality` / `wantsCheap` (hours parsing), brand branch grouping by distance, calibrated 0–100 scores, personalization from search history, and canonical-ID deduplication.
- **Quality and latency gates**: a search benchmark script and a query→expected-results eval fixture that fail when recall@3 or latency regresses.
- **Dependency**: add a maintained `opening_hours` parser if the minimal built-in parser does not cover real data (approved in principle).

**BREAKING**: result ordering and the displayed `% match` score will change as ranking is recalibrated (score is user-visible in `SearchResults`).

## Capabilities

### New Capabilities

- `search-orchestration`: staged/progressive multi-source search, offline city phase, source gating, and the shared consumer search hook (debounce, abort, partials).
- `search-result-cache`: normalized query result caching, in-flight dedupe, TTL/negative caching, and invalidation on data changes.
- `local-search-index`: incremental FTS5 maintenance, weighted/prefix FTS configuration, structured address querying with spatial ranking, and local typo tolerance.
- `search-ranking`: unified relevance scoring v2 — calibrated scores, active intent modifiers, branch grouping, personalization, canonical dedup.
- `search-evaluation`: latency benchmarks and search-quality eval fixtures that gate changes.

### Modified Capabilities

None — `openspec/specs/` contains no existing capabilities yet; this change establishes the initial search specs.

## Impact

- `src/services/search/`: `unifiedSearch.ts`, `searchRanker.ts`, `queryParser.ts`, `photonGeocoder.ts`; new `searchCache.ts`, `searchStages.ts` (or equivalent), new `usePlaceSearch` hook (likely `src/hooks/`).
- `src/services/geocoding/`: `geocodingService.ts` (structured local query, spatial rank), `globalGeocoderService.ts` (wiring + startup download).
- `src/services/poi/`: `poiService.ts` (FTS query composition, bm25), `overtureFetcher.ts` (incremental FTS writes), `categorySearchService.ts` (Nominatim throttle, gating).
- `src/services/database/init.ts`: migrations for FTS prefix indexes/trigram table and spatial index for `geocoding_data`.
- Consumers: `app/(tabs)/search.tsx`, `src/components/map/FloatingSearchPanel.tsx`, `src/components/navigation/AddDestinationPanel.tsx`, `src/services/carplay/carPlayManager.ts`, `SearchResults`/`SearchBar` components.
- Tests/benchmarks: `__tests__/unit/` additions, new `scripts/bench-search.mjs` (Node 22 `node:sqlite`, no new dependency).
- `package.json`: `opening_hours` dependency (added only if justified by tests against real `places.hours` data).
- Docs: `src/services/search/README.md` corrected (source count, GeoNames wiring, new cache/hook).
