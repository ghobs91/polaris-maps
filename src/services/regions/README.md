# Offline Regions

Downloadable region packs with vector tiles, Overture places, and P2P seeding via Hyperdrive.

## Overview

The regions service enables fully offline map usage by downloading region packs that include vector tiles, Overture place data, and routing/geocoding assets. Key features:

1. **Region catalog** — master JSON catalog fetched from CDN, cached in MMKV for instant offline access, and seeded into the `regions` SQLite table
2. **Download orchestration** — tiles from OpenFreeMap TileJSON, places from a prebuilt Overture SQLite bundle, all with progress tracking and cancellation
3. **P2P seeding** — downloaded regions are seeded via Hyperdrive against the pack's canonical key (shared by every seeder, so peers find each other on one swarm). Canonical keys come from a signed region manifest; a bundled manifest provides the offline bootstrap.
4. **Overture import** — the region's prebuilt Overture places SQLite bundle (or a GeoJSON extract from a P2P seed) is imported into the local `places` SQLite table for offline POI search
5. **Connectivity monitoring** — network quality assessment (good/poor/none) via NetInfo for download scheduling decisions

## Files

| File                         | Description                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalogService.ts`          | Fetches master region catalog JSON from CDN, caches in MMKV for offline access, seeds the local `regions` SQLite table with region metadata.                                                                              |
| `downloadService.ts`         | Orchestrates region offline downloads — tiles from OpenFreeMap TileJSON, places from Overture, routing/geocoding assets. Supports P2P peer-assisted downloading via Hyperdrive. Progress tracking and cancellation.       |
| `overtureImporter.ts`        | Imports the region's Overture places into the local SQLite `places` table. Prefers the prebuilt `overture-places.sqlite` bundle (memory-safe, paged); falls back to an `overture-places.geojson` extract from a P2P seed. |
| `regionManifest.ts`          | Signed region-manifest model: canonical payload/signing, signature + trusted-publisher verification, content hashing, and bundled-first/verified-remote merge. Pure (no device identity).                                 |
| `regionManifestPublisher.ts` | Publisher-side manifest signing with the app identity keypair (kept separate so verification stays free of SecureStore).                                                                                                  |
| `regionManifestResolver.ts`  | Resolves the canonical manifest per region from the bundled set merged with verified remote manifests; consulted by the download flow.                                                                                    |
| `regionRepository.ts`        | SQLite CRUD for the `regions` table — get all, get by ID, spatial point lookup (`getRegionForPoint`), upsert, and filter by download status.                                                                              |
| `connectivityService.ts`     | Monitors network connectivity via `@react-native-community/netinfo`. Derives connection quality (good/poor/none) and exposes `isOnline()` for the rest of the app.                                                        |

## Download Flow

```
Region catalog (CDN) → catalogService.ts → regions SQLite table
    ↓
User taps "Download"
    ↓
downloadService.ts
    ├── OpenFreeMap TileJSON → vector tile pack
    ├── Overture SQLite bundle → overtureImporter.ts → places SQLite table
    └── Routing/geocoding assets
    ↓
hyperdriveBridge.ts → seed to P2P network
    ↓
Other peers can download from this device
```

## Related Files

- [`src/services/sync/hyperdriveBridge.ts`](../sync/hyperdriveBridge.ts) — Hyperdrive seed/download IPC
- [`src/services/sync/feedSyncService.ts`](../sync/feedSyncService.ts) — Hypercore feed lifecycle
- [`src/components/regions/`](../../components/regions/) — Region list, download progress UI
- [`app/regions/`](../../../app/regions/) — Region management screen with catalog, download, cancel/delete
