## Why

Overpass is a live query service over OpenStreetMap, and the app depends on it
for two of its most-used interactions: viewport/category POI search and the
"which lines stop here?" transit lookup. That dependency is wrong for this
project on three counts.

1. **It contradicts the architecture.** Every POI search ships the user's map
   viewport to three third-party servers. For an app whose premise is anonymous,
   peer-to-peer mapping, a live viewport leak to `overpass-api.de`,
   `private.coffee`, and `openstreetmap.fr` is the most visible inconsistency in
   the product.
2. **It cannot survive a launch.** `overpassFetch` fires the same query at all
   three mirrors simultaneously and takes the first reply — roughly 3x the load
   on volunteer-run infrastructure per search. A traffic spike would degrade a
   public good and fail most searches anyway.
3. **The answers are precomputable.** The app issues a small, fixed set of query
   shapes (bbox + primary tag set, bbox + `route` relation modes, lines at a
   stop). Those can be computed at pack build time and shipped with the region.

This change moves POI and transit answers onto data the device already holds — or
can verify it holds — and reduces Overpass to an opt-out-able fallback. Polaris
continues to run no CDN, backend, or origin: indices live inside region packs
(already replicated peer-to-peer) and are served by whichever community or
third-party origin hosts the rest of the pack.

## What Changes

- **On-device POI index**: `osm_pois` + `osm_pois_fts` (FTS5) + `local_poi_coverage`
  in the existing SQLite database, queried by bbox, primary tag, arbitrary tag
  (`json_extract`), and name. Coverage distinguishes "no POIs here" from "no data
  here", and only the latter may reach the network.
- **On-device transit index**: stops, route relations with geometry resolved at
  build time, and the stop↔route join — replacing the viewport and stop-card
  Overpass queries.
- **Pack builder**: `search.sqlite` and `transit.sqlite` are produced by
  `scripts/osm-to-search-sqlite.py` in the weekly region-data workflow and the
  local bundle script, using the app's own DDL constants (`PACK_*_SCHEMA_SQL`),
  guarded by a schema-drift test.
- **Content-addressed shards**: `scripts/build-search-shards.mjs` splits POIs
  into geohash cells committed by SHA-256 and Merkle root; `shardManifest`
  verifies bytes, `shardedPoiSource` fetches intersecting cells (pack-local first,
  then peers), verifies, and imports them so the next query is local.
- **Verifiable peer answers**: `verifiableShardIndex` (Merkle inclusion proofs,
  domain-separated leaves, odd-node promotion) and `shardQueryProtocol`
  (transport-free request/response with proof verification, omission detection
  against the committed row count, and a per-peer rate limiter).
- **Overpass becomes a fallback**: sequential mirror attempts (no hedging),
  exponential cooldown per mirror, one request in flight app-wide, identifiable
  `User-Agent`, and a signed remote-config kill switch (`overpassQuery`).
- **Unrelated launch blockers touched while here**: Gun relay health probe so a
  dead seed list self-heals, and a placeholder-origin guard so a release build
  cannot silently ship `cdn.example.com`.

## Capabilities

### New Capabilities

- `local-search-index`: POI and transit answers computed on device from region
  pack data, with coverage accounting that decides when a network fallback is
  permissible.
- `shard-distribution`: content-addressed, hash-verified POI shards that any peer
  or community mirror can serve, plus Merkle-committed peer answers for queries no
  shard satisfies.

### Modified Capabilities

- `region-pack-distribution`: packs gain two optional SQLite artifacts and a shard
  set; downloads fetch, verify, import, and register them.

## Impact

- **Search/POI**: `src/services/poi/{localPoiIndex,shardedPoiSource,verifiableShardIndex,shardQueryProtocol}.ts`, `osmFetcher.ts`, `categorySearchService.ts`.
- **Transit**: `src/services/transit/{localTransitIndex}.ts`, `transitLineFetcher.ts`.
- **Regions**: `src/services/regions/{shardManifest,shardCatalog,packIndices,downloadService,catalogService}.ts`, `src/models/region.ts`.
- **Overpass**: `src/services/overpassClient.ts`, `src/services/config/remoteConfig.ts`.
- **Gun**: `src/services/gun/{init,relayHealth}.ts`.
- **Build**: `scripts/osm-to-search-sqlite.py`, `scripts/build-search-shards.mjs`, `scripts/update-region-asset-urls.mjs`, `scripts/build-region-bundle.sh`, `.github/workflows/build-region-data.yml`.
- **Not included**: the Hyperswarm transport that carries `shardQueryProtocol` (needs a `swarm:bundle` rebuild and a device test); regional delta packs; moving Overture PMTiles off Overture's own archive (already third-party hosted, so out of scope by policy).
