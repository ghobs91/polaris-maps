## 1. Local POI index

- [x] 1.1 Add `osm_pois`, `osm_pois_fts` (FTS5), `local_poi_coverage` and the shared upsert path in `src/services/poi/localPoiIndex.ts`
- [x] 1.2 Pure, testable query builder: bbox + primary-tag predicates + `json_extract` tag filters + FTS name search + nearest-first ordering
- [x] 1.3 Coverage query so "empty answer" and "no data" are distinguishable, and only the latter may hit the network
- [x] 1.4 Pack import via ATTACH + INSERT..SELECT in one transaction, with a row-wise fallback for SQLite builds/providers that refuse ATTACH
- [x] 1.5 Unit tests against real SQLite (`node:sqlite`): ordering, tag filters, `addr:street`/`fuel:diesel` path quoting, FTS prefix search, limit, coverage containment, idempotent re-import

## 2. Local transit index

- [x] 2.1 Add `osm_transit_stops`, `osm_transit_routes` (resolved geometry), `osm_transit_route_stops`, `local_transit_coverage`
- [x] 2.2 Radius query with bbox prefilter + haversine refinement; stop→route join deduplicated by line identity, mapped onto `TransitMode`
- [x] 2.3 Pack import (ATTACH fast path + row-wise fallback), region-scoped replacement
- [x] 2.4 Unit tests: geometry helpers, mode mapping, schema/join behaviour

## 3. Wire the indices into search

- [x] 3.1 `osmFetcher` consults the index first for viewport POIs, tag searches, and name searches; any index failure degrades to the previous behaviour
- [x] 3.2 `categorySearchService` merges indexed OSM POIs with Overture results before the sufficiency check
- [x] 3.3 `transitLineFetcher.fetchRoutesAtStop` answers from the index when the point is covered
- [x] 3.4 Keep the existing Overpass response cache semantics for the fallback path

## 4. Shard distribution

- [x] 4.1 `shardManifest`: signed descriptors (`shardId`, `path`, `bytes`, `sha256`, `merkleRoot`, bbox, `poiCount`), verification, point/bbox selection, `fetchVerifiedShard`, peer-first ordering
- [x] 4.2 `verifiableShardIndex`: domain-separated Merkle tree with odd-node promotion, inclusion proofs with explicit per-level siblings, answer verification, completeness check
- [x] 4.3 `shardedPoiSource`: viewport → descriptors → verified fetch → import → coverage, with a shard cache and a short negative cache
- [x] 4.4 `shardCatalog`: register a pack's shards (signed manifest preferred, unsigned index tolerated with content-only integrity)
- [x] 4.5 Tests: byte/Merkle verification, tampered payloads, refetch on version change, tampered peer rejected, no-op when unregistered

## 5. Verifiable peer answers

- [x] 5.1 `shardQueryProtocol`: normalised query, predicate matching, responder producing proofs, client verification against the manifest root
- [x] 5.2 Reject fabrication, wrong root, wrong shard, and (with a committed count) omission
- [x] 5.3 Per-peer token-bucket rate limiter
- [x] 5.4 Hyperswarm transport binding: worklet responder reads `shards/<cell>.jsonl` from the pack it seeds, answers with proofs over a length-prefixed JSON frame protocol on the shard topic; RN client verifies against the manifest root. Contract test runs the worklet module under Node and compares roots/proofs with the app verifier. Bundle rebuilt with `bare-pack`.

## 6. Overpass demotion

- [x] 6.1 Sequential mirror fallback with per-mirror exponential cooldown, one request in flight app-wide, identifiable `User-Agent`
- [x] 6.2 Signed remote-config kill switch (`overpassQuery`) plus a local override; nothing depends on the config being reachable
- [x] 6.3 Update the existing tests that asserted the old hedged behaviour

## 7. Build pipeline

- [x] 7.1 `scripts/osm-to-search-sqlite.py` — both indices from a clipped PBF, route geometry from railway way members
- [x] 7.2 `scripts/build-search-shards.mjs` — geohash cells, per-shard SHA-256 + Merkle root, `shards.json`
- [x] 7.3 Workflow + bundle script emit, size, and publish the new assets
- [x] 7.4 `scripts/update-region-asset-urls.mjs` stamps catalog asset URLs (community/third-party origin, never project-hosted)
- [x] 7.5 Tests: builder↔app Merkle parity, Python DDL ↔ app schema drift, catalog stamping

## 8. Related launch blockers

- [x] 8.1 Gun relay health probe with TTL cache, seeds preserved as fallback, `EXPO_PUBLIC_GUN_RELAYS` override
- [x] 8.2 Placeholder-origin guard so a release build cannot silently fetch `cdn.example.com`
- [x] 8.3 Catalog origin: the CI build publishes `catalog.json` as a GitHub Release asset (`--out` mode of `update-region-asset-urls.mjs`), so `EXPO_PUBLIC_REGION_CATALOG_URL` can point at `.../releases/latest/download/catalog.json` with no project-hosted infrastructure. Documented in `.env.example`.
