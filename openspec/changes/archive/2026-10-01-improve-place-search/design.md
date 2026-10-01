# Design — Improve Place Search

## Context

`unifiedSearch` (`src/services/search/unifiedSearch.ts`) runs a local phase (FTS5 `places`, category search, address FTS) and then awaits `Promise.allSettled` over six network sources (Photon, Overpass category, Nominatim address, Overture viewport, Overture user-location, Overpass name-regex). The final list is produced only after every source settles. `fetchOverturePlaces` upserts rows and then runs a full FTS `rebuild` on the shared SQLite connection. There is no result cache. Parsed intent fields (`wantsOpenNow`, `wantsQuality`, `wantsCheap`) are unused. Local address search ignores reference coordinates. `globalGeocoderService` (GeoNames cities1000) is implemented but never downloaded or called. Four UI consumers each implement their own debounce/abort/partial behavior, one of them with neither debounce nor abort.

Constraints carried into this design:

- Keep public Photon/Nominatim/Overpass endpoints; no proxy infrastructure (decision by product owner).
- Do not hand-edit generated native projects; no new native modules.
- TypeScript strict, pnpm workspace, Jest 29; follow existing service/module conventions.
- `opening_hours` dependency is allowed if justified by real-data tests.
- The displayed `% match` score is user-visible; ranking changes are observable behavior.

## Goals / Non-Goals

**Goals:**

- Make the first meaningful result set appear as soon as each fast source resolves, never blocked by the slowest source.
- Remove O(N)-per-search work (full FTS rebuild) and repeated network work (no cache) from the common path.
- Use offline assets already in the repo (GeoNames, region DBs) to answer quickly.
- Make ranking use the intent the parser already extracts, and keep scores calibrated and testable.
- Pin behavior with latency benchmarks and query→expected-result evals so "faster/smarter" is measurable.

**Non-Goals:**

- No server-side search infrastructure, proxy, or hosted indexing.
- No on-device ML/embeddings reranker.
- No change to P2P data models or sync semantics.
- No UI redesign beyond what staged results and branch grouping require.

## Decisions

### 1. Staged emission with stable ordering (not one final merge)

Replace `onPartial` with a staged callback contract: `onStage(results, { stage, final })`. Stages: `local`, `cities`, `photon`, `category`, `remaining`. Each stage re-runs the existing scoring/dedup assembly over the accumulated source set, so ordering is globally consistent at every emission. Results are keyed (canonical id, then normalized name + geohash cell) and never removed or reordered across stages except by score; new results are inserted in rank order. UI re-sorts are throttled to animation-frame cadence.

- Alternative: append-only streaming (never reorder) — rejected: slower stages would append low-relevance results after high-relevance ones; users expect rank order.
- Alternative: fix all network timeouts to a small budget (e.g. 1.5s) and show "best effort" — rejected alone: hides recall in sparse areas; used in addition to gating and cache.

### 2. Incremental FTS maintenance in the Overture upsert

`upsertOverturePlaces` already disables triggers and performs a bulk upsert in an exclusive transaction. Instead of the post-transaction `INSERT INTO places_fts(places_fts) VALUES('rebuild')`, delete and re-insert FTS rows for exactly the upserted rowids within the same transaction (`INSERT INTO places_fts(places_fts, rowid, ...) VALUES('delete', ...)` then insert). Re-create triggers afterward as today. `rebuild` + `optimize` remain for region import and idle maintenance only. This removes O(total places) work from every search that fetches Overture tiles.

- Alternative: debounce `rebuild` to idle — rejected: still O(N) and still competes with foreground queries on the single connection.
- Consistency guard: after maintenance, compare `SELECT count(*) FROM places` to `SELECT count(*) FROM places_fts`; if mismatched (e.g. interrupted migration), fall back to `rebuild` once.

### 3. In-memory LRU result cache with in-flight dedupe

New `src/services/search/searchCache.ts`: bounded LRU (default 100 entries) keyed by `normalizeSearchText(query)` + quantized bbox (`0.005°` buckets) + rounded reference point + options digest (`limit`, `localOnly`). TTL 5 minutes; empty results 60 seconds (negative cache); in-flight `Map<key, Promise>` so concurrent identical searches from different consumers share one execution.

- Scope: cache the merged network-augmented result, not the local phase (local queries are already milliseconds and must reflect fresh DB writes).
- Invalidation: `invalidateSearchCacheForBbox(bounds)` called from `upsertOverturePlaces` and region import/delete.
- Alternative: SQLite/MMKV persistent cache — rejected: adds serialization cost and privacy surface; memory cache covers the session, which is where the latency pain is.

### 4. Source gating on local sufficiency and query class

Compute `localConfidence` after the local + cities stages: count of results with `textMatchScore >= 0.72` within the search radius (existing `inferQueryDensity` already computes a subset of this). Gating rules (named constants, tunable in one module):

- `strongMatches >= SUFFICIENT_LOCAL` (default 8) and query is a category query → skip Overpass category fallback and Overture fetches.
- `strongMatches >= SUFFICIENT_LOCAL` and query matched a brand alias → skip Overpass name search; still allow one Overture viewport fetch when the viewport has no region coverage.
- Address query with an exact structured local hit (house number + street) → skip Nominatim.
- Sparse/normal density → all sources run as today.

Gating never changes the ranking formula; it only removes sources whose expected marginal recall is below a threshold. Evals must include sparse-local fixtures to prevent silent recall regressions.

### 5. Wire GeoNames as a first-class fast source

Call `ensureGeonamesDb()` opportunistically (first online idle after startup, Wi-Fi preferred, size ~20-25 MB) and add `searchGlobalPlaces` to the local/cities stage with proximity + population ranking. Graceful no-op when the configured URL is the placeholder or the download fails. The UI gets city results in the staged emission before any network POI source returns.

### 6. Shared consumer hook

New `usePlaceSearch` hook owning: input state, debounce (default 250 ms for network, immediate local-only pass), `AbortController` lifecycle, staged result application with generation checks, and result dedupe across stages. Consumers keep their own limits/options via parameters. `FloatingSearchPanel`'s stop-search path and `AddDestinationPanel` adopt it, removing the no-debounce/no-abort paths. CarPlay keeps its call site but through the same hook logic (non-React variant: exported `createSearchSession()` helper used by the hook).

### 7. Local index: prefix FTS, bm25, structured addresses, trigram

- `places_fts`: recreate with `prefix='2 3 4'` in an idempotent migration, then `rebuild`. Query with `bm25(places_fts, 10.0, 6.0, 2.0, 1.0)` column weights; normalize to 0–1 and feed `textMatchScore` as a signal (replacing the current "rank is discarded" behavior). Existing manual `textMatchScore` remains for fuzzy/synonym logic.
- `geocoding_data`: add `places_trigram`-style `geocoding_trigram` FTS5 table with `tokenize='trigram'` for substring/typo street search; query it when the primary FTS yields few results. Structured query: token classify → FTS column filters (`housenumber:"123" + street:"main" + city:"brooklyn"`) with distance re-ranking in JS over the top ~50 rows. Reference `lat/lng` passed from `searchAddress` are finally used for local ranking.
- Size trade-off: the trigram index roughly duplicates token storage for the geocoding table (region packs), so it is created only for `geocoding_data` (smaller than places) in this change; places trigram deferred until benchmarks justify it.
- Migration risk: recreating FTS virtual tables drops the old index; the migration rebuilds from content tables, which is safe for external-content tables.

### 8. Ranking v2 behind calibrated output

- Keep the weighted-sum architecture (text/distance/category/popularity/viewport) but cap the total at 100 and rebalance so a "perfect" result reaches ~100 only with an exact name/brand match, close distance, category and popularity signals.
- Activate modifiers: `wantsOpenNow` demotes/removes results whose parsed `hours` prove closed (unknown hours are not filtered); `wantsQuality` adds a bounded rating-prior term (Bayesian-smoothed rating, `C/(C+m)` shrinkage); `wantsCheap` prefers lower price levels when data exists.
- Hours parsing: thin `parseOpenNow(hours, at)` adapter. Start with a minimal parser for `24/7`, `Mo-Fr 09:00-17:00`, day lists, and `closed`; add `opening_hours` only if fixture coverage is below target (measured in eval tests).
- Brand queries: order branches by distance, include `brand` + branch count metadata so the UI can group; no synthetic single entry that hides branches.
- Personalization: extend `searchHistoryService` to store query text + selected place id/coords + timestamp; ranker applies a bounded boost (≤ 5 points) when a candidate matches a previously selected result for the same normalized query prefix. Local-only, no network.
- Dedup: prefer canonical ids (`osm_type:osm_id` when present, `places.uuid` for Overture rows) before the existing fuzzy name+distance heuristic.

### 9. Evaluation harness

- `scripts/bench-search.mjs` using Node 22 `node:sqlite`: seeds a synthetic `places`/`places_fts` DB (e.g. 100k rows) and times FTS queries, prefix/trigram lookups, structured address queries, incremental upsert vs full rebuild. Emits JSON; added as `pnpm search:bench` (no new dependency).
- `__tests__/unit/searchEval.test.ts`: fixture of ≥30 realistic queries with expected top-3 results, run through `unifiedSearch` with mocked sources and the real ranker; asserts recall@3/NDCG thresholds. This is the regression gate for "smarter".
- Orchestration unit tests assert staged emission ordering with simulated source latencies and call counts proving gating.

## Risks / Trade-offs

- [Progressive reordering feels jumpy] → stages only ever re-rank existing rows; throttle UI updates to one per frame; keep stable keys.
- [Cache serves stale POIs] → 5 min TTL, bbox invalidation on Overture upsert/region import; negative cache limited to 60 s; local phase never cached.
- [Gating hides relevant results in edge areas] → conservative thresholds, eval fixtures for sparse areas, all sources still run at normal/sparse density.
- [FTS incremental maintenance corrupts external-content index] → same-transaction delete+insert, count consistency check with automatic `rebuild` fallback, unit test upserting rows then querying them.
- [FTS migration (prefix indexes) is slow on large region packs] → run once per DB version; migration is resumable via `rebuild`; benchmark before/after.
- [Trigram index size] → limited to `geocoding_data`; measured in benchmark; droppable migration.
- [Ranking changes reorder visible results] → eval gates, score capped/calibrated, `% match` label reviewed (may become "match" or be recomputed), changelog note.
- [Hours data sparse or OSM-syntax-heavy] → unparseable hours treated as unknown (never filtered as closed); dependency only if parser coverage demands it.
- [GeoNames download is large and default URL is a placeholder] → opportunistic, Wi-Fi-preferred, cancellable; feature no-ops when unavailable.
- [Schema migration duplicates index build work] → migrations guarded by `user_version`/MMKV flag; only rebuilt when the FTS config version changes.

## Migration Plan

1. Ship cache + staged emission + consumer hook + Gating (no schema change) — pure JS, reversible.
2. Ship incremental FTS maintenance in `upsertOverturePlaces` (reversible; `rebuild` still available).
3. Ship FTS/geocoding migrations (prefix index, FTS config version flag, trigram table for `geocoding_data`); fallback to `rebuild` on inconsistency.
4. Ship ranking v2 + intent signals + personalization + dedup; evals gate the change.
5. Update `src/services/search/README.md` and `AGENTS.md` search notes.

Rollback: steps 1–2 are code-only; step 3 schema additions are idempotent and can remain unused; step 4 is behind scoring constants and can be reverted to v1 weights without schema changes.

## Open Questions

- ~~Should the result score remain user-visible as `% match`~~ **Resolved**: kept as `% match` for now (clamped 0–100); scores are now capped and calibrated so the display is honest. Revisit if user feedback suggests a coarser label.
- Is `opening_hours` data populated by the region generation pipeline (`scripts/generate-region-data.sh`) enough for open-now filtering to matter, or should it ship dark until imports carry hours? **Decision**: the `open now` modifier demotes only results whose hours parse; unparseable/missing hours are treated as unknown and never filtered, so shipping dark is safe.
- Should the result cache also cover CarPlay/app-restart sessions (MMKV persistence), or is session-scoped memory caching sufficient? **Decision**: session-scoped memory caching is sufficient for this change.
- `opening_hours` dependency: **Decision**: not added — the minimal parser covers the fixture corpus; revisit if real data shows coverage gaps.

## Baseline Benchmarks

Measured with `pnpm search:bench` (`node scripts/bench-search.mjs`) on Node v26.8.2 (darwin), 100,000 synthetic places + 30,000 geocoding rows, seed 42, WAL journal, 10 iterations per query measurement.

| Measurement (100k places)        | Baseline FTS (no prefix) | v2 FTS (`prefix='2 3 4'`) |
| -------------------------------- | -----------------------: | ------------------------: |
| Name-prefix FTS query (p50)      |                  4.95 ms |                   4.02 ms |
| Name-prefix FTS query (p95)      |                 19.04 ms |                   4.76 ms |
| Two-character prefix query (p50) |                  7.43 ms |                   6.79 ms |
| Structured address FTS (p50)     |                  0.42 ms |                   0.44 ms |
| Trigram typo lookup (p50)        |                  0.05 ms |                   0.05 ms |
| Incremental upsert, 200 rows     |                  4.78 ms |                  33.97 ms |
| Full FTS rebuild                 |                 102.7 ms |                  259.9 ms |
| DB size                          |                  38.4 MB |                   53.0 MB |

Baseline takeaway: a full FTS rebuild (today's post-Overture-fetch path) costs ~103–260 ms per search against 100k places and scales linearly with the table, while incremental maintenance for a 200-row fetch stays O(batch) at roughly 5–34 ms. Prefix indexes stabilize the p95 of short prefix queries at the cost of larger rebuilds and per-row maintenance; the incremental path still wins by ~7.6x at this scale and the gap widens as the table grows.

After implementing the incremental path (group 7), the benchmark's `upsert_incremental_200` measurement includes the existing-row lookup + `INSERT ... RETURNING` flow used by the app: p50 33.8 ms vs 256.1 ms for a full rebuild at 100k rows (7.6x), with the rebuild cost growing linearly and the incremental cost staying constant per batch.

Reproduce: `pnpm search:bench --rows=100000 --iterations=10` and `pnpm search:bench --rows=100000 --places-fts=baseline --iterations=10`.

## Implementation Verification

Recorded after all task groups landed:

- `pnpm typecheck` — pass.
- `pnpm lint` — 0 errors (25 pre-existing warnings across the repo; none introduced by this change).
- `pnpm format:check` — pass.
- `pnpm test` — 93 suites: 72 pass, 21 fail; 848 tests: 835 pass, 13 fail. All 21 failing suites and 13 failing tests were verified identical on a clean `HEAD` worktree (native-module/ESM transform issues unrelated to search): the change adds 9 suites / 56 passing tests with no regressions.
- Search suites — 14 suites / 133 tests pass, including the 37-query eval fixture (recall@3 = 1.0 at the fixture ceiling), staged emission, cache, gating, incremental FTS, and structured/trigram index tests.
- `pnpm search:bench --rows=100000` — incremental 200-row upsert p50 32.7 ms vs full FTS rebuild p50 260.6 ms (8.0x); index size 53.0 MB with prefix + trigram indexes vs 38.4 MB baseline.
