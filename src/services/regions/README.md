# Offline Regions

Downloadable region packs with vector tiles, Overture places, and P2P seeding via Hyperdrive.

## Overview

The regions service enables fully offline map usage by downloading region packs that include vector tiles, Overture place data, and routing/geocoding assets. Key features:

1. **Region catalog** — master JSON catalog fetched from CDN, cached in MMKV for instant offline access, and seeded into the `regions` SQLite table
2. **Download orchestration** — tiles from OpenFreeMap TileJSON, places from a prebuilt Overture SQLite bundle, all with progress tracking and cancellation
3. **P2P seeding** — downloaded regions are seeded via Hyperdrive against the pack's canonical key (shared by every seeder, so peers find each other on one swarm). Canonical keys come from a signed region manifest; a bundled manifest provides the offline bootstrap.
4. **Overture import** — the region's prebuilt Overture places SQLite bundle (or a GeoJSON extract from a P2P seed) is imported into the local `places` SQLite table for offline POI search
5. **Connectivity monitoring** — network quality assessment (good/poor/none) via NetInfo for download scheduling decisions
6. **Manifest gossip** — signed region manifests (with canonical pack keys) are discovered peer-to-peer over Gun.js, verified before merge, relayed, and persisted so discovery does not depend on the catalog CDN. Bundled manifests remain the compiled-in root of trust; an optional per-region M-of-N publisher quorum guards against a single compromised publisher.

## Files

| File                         | Description                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalogService.ts`          | Fetches master region catalog JSON from CDN, caches in MMKV for offline access, seeds the local `regions` SQLite table with region metadata.                                                                                                                                                                             |
| `downloadService.ts`         | Orchestrates region offline downloads — tiles from OpenFreeMap TileJSON, places from Overture, routing/geocoding assets. Supports P2P peer-assisted downloading via Hyperdrive. Places gunzip + routing tar run in the Bare Hyperdrive worklet. Progress tracking and cancellation.                                      |
| `overtureImporter.ts`        | Imports the region's Overture places into the local SQLite `places` table. Prefers the prebuilt `overture-places.sqlite` bundle (memory-safe, paged); falls back to an `overture-places.geojson` extract from a P2P seed.                                                                                                |
| `regionManifest.ts`          | Signed region-manifest model: canonical payload/signing, signature + trusted-publisher verification, content hashing, and bundled-first/verified-remote merge. Pure (no device identity).                                                                                                                                |
| `regionManifestPublisher.ts` | Publisher-side manifest signing with the app identity keypair (kept separate so verification stays free of SecureStore).                                                                                                                                                                                                 |
| `regionManifestResolver.ts`  | Resolves the canonical manifest per region from the bundled set merged with verified remote manifests; consulted by the download flow.                                                                                                                                                                                   |
| `shardManifest.ts`           | Signed, content-addressed shard manifests: per-cell descriptors (`sha256`, byte length, bbox, POI Merkle root), signature/publisher verification reusing the region-manifest trust root, point/bbox shard selection, and `fetchVerifiedShard` (tries mirrors/peers in order, discards any payload whose hash disagrees). |
| `packIndices.ts`             | Best-effort import of a pack's optional `search.sqlite` (named OSM POIs) and `transit.sqlite` (stops/route relations/stop↔route join) into the on-device indices. Never fails a download.                                                                                                                                |
| `regionManifestGossip.ts`    | Peer-to-peer manifest discovery over Gun.js — publish/subscribe at `polaris/region-manifests/<regionId>/<publisherPubkey>`, verify-before-merge, relay, and bounded MMKV persistence.                                                                                                                                    |
| `regionRepository.ts`        | SQLite CRUD for the `regions` table — get all, get by ID, spatial point lookup (`getRegionForPoint`), upsert, and filter by download status.                                                                                                                                                                             |
| `connectivityService.ts`     | Monitors network connectivity via `@react-native-community/netinfo`. Derives connection quality (good/poor/none) and exposes `isOnline()` for the rest of the app.                                                                                                                                                       |
| `mirrorSelector.ts`          | Pure multi-origin policy: origin rotation for load distribution, failure cooldowns, and health pruning. Unit tested without touching MMKV or the network.                                                                                                                                                                |
| `mirrorHealth.ts`            | Persists mirror health + the rotation counter in MMKV (in-memory fallback), and applies `mirrorSelector` to each asset's source list.                                                                                                                                                                                    |

## Pack origins (multi-tier CDN)

Packs and routing graphs are published to **four interchangeable origins**. No
origin is required beyond GitHub Releases; each additional one adds redundancy
and takes a share of the download load.

| Tier | Origin           | Role                                                   |
| ---- | ---------------- | ------------------------------------------------------ |
| 1    | GitHub Releases  | Primary; where CI publishes and the catalog is stamped |
| 2    | Cloudflare R2    | Redundancy + load; zero egress                         |
| 3    | Backblaze B2     | Redundancy + load                                      |
| 4    | Internet Archive | Redundancy + archival                                  |

Two pieces make them interchangeable rather than "primary plus fallbacks":

- **Load distribution** (`mirrorSelector.ts`) — the catalog's primary URL and
  its `mirrors` are rotated by a persisted counter, so clients start on
  different origins instead of every first byte hitting GitHub. An origin that
  fails goes into an exponential cooldown (`mirrorHealth.ts`, MMKV-persisted)
  and is pushed to the back rather than being retried first on every asset.
- **Integrity** — each transfer is verified against the catalog's `md5` before
  it is expanded (`downloadResumable({ verify })`). A mirror that serves the
  wrong bytes is deleted and demoted, so a cheap third-party origin is only ever
  trusted for availability, never for correctness.

The catalog carries `assetBaseUrls` (every origin) and `assetTag` (the release
the URLs were stamped from), which is what lets the routing-graph downloader
resolve `<origin>/<tag>/<region>-routing.tar` against any mirror — and without a
GitHub API call for the current tag.

Publication:

```bash
# Stamp the catalog with every origin (repeatable, optionally labelled):
node scripts/update-region-asset-urls.mjs --tag map-data-2026-01 --out catalog.json \
  --mirror r2=https://packs.example-r2.dev \
  --mirror b2=https://packs.s3.us-west-004.backblazeb2.com \
  --mirror ia=https://archive.org/download/polaris-packs

# Mirror a built region's assets (`--dry-run` prints the plan):
scripts/publish-region-mirrors.sh map-data-2026-01 work/us-ny-new-york
```

In CI the mirror step is opt-in: set the `POLARIS_PACK_MIRRORS` repository
variable to `true` and configure the rclone remotes as secrets. With nothing
configured, the job warns and GitHub Releases remains the only origin.

## Pack search indices (optional)

Packs may ship two SQLite artifacts that remove live Overpass/transit queries
from the covered area entirely:

| File             | Contents                                                                                 | Consumer                             |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| `search.sqlite`  | `osm_pois` (named POIs with primary tag + `tags_json`)                                   | `services/poi/localPoiIndex`         |
| `transit.sqlite` | `osm_transit_stops`, `osm_transit_routes` (geometry resolved), `osm_transit_route_stops` | `services/transit/localTransitIndex` |

Builders should use `PACK_POI_SCHEMA_SQL` / `PACK_TRANSIT_SCHEMA_SQL` from those
modules — the importers attach the file and copy the rows with the region id
stamped on, inside one transaction. Both are listed in the pack index, so their
bytes are covered by the manifest's `contentHash`. A pack that omits them still
downloads normally and simply keeps the network fallback.

### Producing these artifacts

Two in-repo builders emit them, and both should be extended before adding a new
asset type:

| Builder                                   | Use                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/build-region-data.yml` | Weekly CI build: PMTiles, Valhalla tiles, geocoding DB, `search.sqlite`, `transit.sqlite`, `search-shards.tar` → GitHub Releases                |
| `scripts/build-region-bundle.sh`          | Local bundle for a single Geofabrik slug: geocoding + Overture places + bodies + shards + a `manifest-entry.json` with the asset URLs and sizes |

`scripts/osm-to-search-sqlite.py` writes both indices from the clipped PBF using
the `PACK_*_SCHEMA_SQL` constants from the app (so schema drift fails fast). POIs
come from a single DuckDB `ST_ReadOSM` pass; transit from an osmium walk, which
can assemble ordered route-relation geometry. Each POI keeps only the tags the
app reads (`scripts/poi-tags.json`): on a dense metro the full tag maps were 87%
of the search index's payload, and most of it was `surface`/`check_date`/`source`
metadata no screen touches. `scripts/build-search-shards.mjs`
splits `search.sqlite` into geohash cells with
per-shard SHA-256 and Merkle roots. That pairing is pinned by
`__tests__/unit/shardBuilderParity.test.ts`, which rebuilds the roots with the
app's verifier — if the two ever disagree, every shard would look corrupt on
device.

## Sharded distribution

`shardManifest.ts` splits a pack's POI data into independently fetchable cells
and commits each to a SHA-256 plus a Merkle root over its entries.

Shards live **inside the region pack**, so they are replicated the same way the
pack is: every seeding peer already holds them and serves them over
Hyperdrive/Hyperswarm, and `fetchVerifiedShard` tries peer sources first. An
optional HTTP source means a community or third-party archive — Polaris operates
no CDN, backend, or origin, and this path must keep working with no such source
available. Because each shard is committed by hash, sources are interchangeable
and untrusted: `fetchVerifiedShard` discards any payload that does not hash to
the signed descriptor and retries the next source.

The Merkle root is the anchor for peer-computed answers
(`services/poi/verifiableShardIndex`), which returns matching rows with
inclusion proofs instead of trusting the responder.

## Download Flow

```
Region catalog (CDN, optional) ─┐
Signed manifest gossip (Gun.js) ─┴→ regionManifestResolver → canonical pack key
    ↓
User taps "Download"
    ↓
downloadService.ts
    ├── OpenFreeMap TileJSON → vector tile pack
    ├── Overture SQLite bundle → overtureImporter.ts → places SQLite table
    └── Routing/geocoding assets
    ↓
hyperdriveBridge.ts → seed to P2P network (canonical key)
    ↓
Other peers can download from this device
```

## OpenFreeMap offline policy

OpenFreeMap permits offline area downloads only when each download is at most
3,000 tiles / 50 MB, uses **at most 4 parallel requests**, and identifies the
app with a unique User-Agent. `tileDownloadPlan.ts` enforces the tile budget by
lowering max zoom for oversized bounds (rather than chunking into multiple
non-conformant pulls), `downloadViaHttp` uses 4-way concurrency, sends
`PolarisMaps/1.0 (+https://app.polarismaps.app)`, and aborts if the byte count
exceeds 50 MB. Self-hosting/mirroring is intentionally out of scope: Polaris
does not host user-facing data.

## Related Files

- [`src/services/sync/hyperdriveBridge.ts`](../sync/hyperdriveBridge.ts) — Hyperdrive seed/download IPC
- [`src/services/sync/feedSyncService.ts`](../sync/feedSyncService.ts) — Hypercore feed lifecycle
- [`src/components/regions/`](../../components/regions/) — Region list, download progress UI
- [`app/regions/`](../../../app/regions/) — Region management screen with catalog, download, cancel/delete
