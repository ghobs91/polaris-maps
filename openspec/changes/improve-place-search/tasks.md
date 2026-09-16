# Tasks — Improve Place Search

Ordered so that perceived-latency work lands first; each group is independently shippable.

## 1. Baseline measurement and guardrails

- [x] 1.1 Add `scripts/bench-search.mjs` using Node 22 `node:sqlite`: seed a synthetic `places`/`places_fts`/`geocoding_data` DB (~100k rows), measure local FTS query, prefix lookup, structured address lookup, trigram lookup, and incremental upsert vs full rebuild; print JSON with p50/p95
- [x] 1.2 Add a `search:bench` script to `package.json` (no new dependency) and document how to run it
- [x] 1.3 Run the benchmark on `main` and record baseline numbers in the change notes
- [x] 1.4 Create `__tests__/unit/searchEval.test.ts` with ≥30 realistic queries and expected top-3 results, running `unifiedSearch` with mocked sources; assert recall@3 and NDCG thresholds from the current behavior
- [x] 1.5 Add mocked-source orchestration tests that simulate source latencies and assertions for emission order (initially for current partial behavior, extended in group 4)

## 2. Shared search session and consumer adoption

- [x] 2.1 Create `createSearchSession()` in `src/services/search/searchSession.ts` owning debounce, abort lifecycle, local-first pass, and generation checks
- [x] 2.2 Create `src/hooks/usePlaceSearch.ts` wrapping the session for React consumers (input state, results, isSearching, submit)
- [x] 2.3 Adopt `usePlaceSearch` in `app/(tabs)/search.tsx` (preserve coordinate/Plus Code pre-flight)
- [x] 2.4 Adopt `usePlaceSearch` in `FloatingSearchPanel.tsx` for both the main input and the add-stop search path (adds missing debounce/abort)
- [x] 2.5 Adopt `usePlaceSearch` in `AddDestinationPanel.tsx` (adds missing abort/partial behavior)
- [x] 2.6 Route `carPlayManager.ts` search through `createSearchSession`
- [x] 2.7 Unit tests: new input aborts in-flight search; stop-search is debounced; superseded results never applied

## 3. Result cache and request dedupe

- [x] 3.1 Implement `src/services/search/searchCache.ts`: bounded LRU, TTL (5 min results, 60 s empty), key from normalized query + quantized bbox + reference point + options digest
- [x] 3.2 Wire the cache into `unifiedSearch` for the network-augmented merge; keep the local phase uncached
- [x] 3.3 Add in-flight promise dedupe so concurrent identical searches execute sources once
- [x] 3.4 Add `invalidateSearchCacheForBbox()` and call it from `upsertOverturePlaces` and region import/removal
- [x] 3.5 Unit tests: second identical search issues zero network calls; concurrent identical searches share one execution; LRU eviction; invalidation on upsert

## 4. Staged result emission

- [x] 4.1 Add a staged callback contract to `SearchOptions` (`onStage(results, { stage, final })`) with stages `local`, `cities`, `photon`, `category`, `remaining`; keep `onPartial` as a deprecated alias during migration
- [x] 4.2 Refactor `unifiedSearch` to emit after each stage using the existing `assembleResults` scoring/dedup path
- [x] 4.3 Ensure staged emissions never remove or reorder earlier results except by merged duplicates and score order; key results stably (canonical id → normalized name + geohash cell)
- [x] 4.4 Throttle UI re-sorts in `usePlaceSearch` to one per animation frame
- [x] 4.5 Unit tests: stage order with simulated latency; slow source does not block faster stages; duplicate emitted once; `final` flag set on last emission

## 5. Source gating, timeouts, and Nominatim policy

- [x] 5.1 Add gating constants and a `computeLocalConfidence()` helper derived from `inferQueryDensity` and strong-match counts
- [x] 5.2 Gate Overpass category fallback, Overpass name search, Overture fetches, and Nominatim fallback per the gating rules in `design.md`
- [x] 5.3 Extract the Nominatim throttle from `geocodingService.ts` into a shared abort-aware util and apply it to `categorySearchService.ts` fallback
- [x] 5.4 Bound every network source timeout to ≤8 s (including the Overpass name-search query timeout) and treat timeouts as empty results
- [x] 5.5 Unit tests: call-count assertions when local results are sufficient; all sources run when sparse; throttle wait is aborted promptly

## 6. Offline GeoNames city phase

- [x] 6.1 Trigger `ensureGeonamesDb()` opportunistically on first online idle after startup (Wi-Fi preferred, cancellable)
- [x] 6.2 Add `searchGlobalPlaces` to the `cities` stage with text + population + proximity ranking
- [x] 6.3 Handle placeholder URL / download failure as a silent no-op with later retry
- [x] 6.4 Unit tests: city appears in cities-stage emission; unavailable DB degrades without error

## 7. Incremental FTS maintenance

- [x] 7.1 Replace the full `places_fts` `rebuild` in `upsertOverturePlaces` with same-transaction delete+insert for upserted rowids; restore triggers afterward
- [x] 7.2 Add row-count consistency check with one-time `rebuild` recovery
- [x] 7.3 Unit tests: upserted rows are immediately searchable; no `rebuild` executes on the search path
- [x] 7.4 Benchmark before/after for a 200-place upsert against a 100k-row table

## 8. Local index upgrades

- [x] 8.1 Add an FTS configuration version flag and idempotent migration recreating `places_fts` with `prefix='2 3 4'`, then `rebuild`
- [x] 8.2 Switch `searchPlacesFts` to `bm25(places_fts, 10.0, 6.0, 2.0, 1.0)` and pass a normalized relevance signal into the ranker
- [x] 8.3 Implement structured address token classification and an FTS column-filter query with distance re-ranking over the top matches in `geocodingService.ts`
- [x] 8.4 Add the `geocoding_data` trigram FTS table with migration + triggers; merge trigram results as lower-ranked additions when primary matches are insufficient
- [x] 8.5 Unit tests: name match outranks city match; nearby duplicate address ranks first; "starbuks"-style typo resolves locally; two-character prefix does not use `LIKE '%...%'`
- [x] 8.6 Benchmark: index size and query time after prefix/trigram changes

## 9. Ranking v2

- [x] 9.1 Cap and rebalance scores to 0–100; audit each weight against the eval fixture
- [x] 9.2 Implement `parseOpenNow(hours, at)` with a minimal common-syntax parser; add the `opening_hours` dependency only if fixture coverage is insufficient (record the decision)
- [x] 9.3 Apply open-now demotion (never exclusion for unknown hours) and quality/price adjustments in `searchRanker.ts`
- [x] 9.4 Order brand branches by distance and attach brand + nearby-branch-count metadata for UI grouping
- [x] 9.5 Extend `searchHistoryService` to persist query + selected place and apply a bounded personalization boost
- [x] 9.6 Add canonical-identifier dedup (OSM type:id, Overture UUID) ahead of fuzzy dedup
- [x] 9.7 Update eval fixtures with ranking-v2 expectations; assert no recall@3 regression and record NDCG improvement
- [x] 9.8 Decide with product owner whether `% match` stays user-visible or becomes a coarser label; update `SearchResults` accordingly

## 10. Documentation and final verification

- [x] 10.1 Update `src/services/search/README.md`: source list, staged emissions, cache, session hook, GeoNames wiring, ranking v2
- [x] 10.2 Update `AGENTS.md` search notes if service contracts changed
- [x] 10.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, the search eval suite, and `pnpm search:bench`; record results in the change notes
