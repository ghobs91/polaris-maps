# Place Lists & Favorites

User-curated place lists with multi-format import, iCloud sync, and favorites management.

## Overview

The places system enables users to organize saved locations into lists:

1. **Place lists** — full CRUD with cross-list move, MMKV persistence, sort by recent/name/distance
2. **Multi-format import** — CSV, JSON, GeoJSON, KML/KMZ, and GPX files from Google Maps Takeout and third-party tools. Extracts coordinates from Google Maps URLs.
3. **iCloud sync** — iOS-only Key-Value storage via native `PolarisCloudStore` module. Pull on mount, debounce-push on local changes, merge on iCloud update events.
4. **Favorites** — Home, Work, and pinned locations with ordering logic (Home/Work always at top)

## Files

### Places (`src/services/places/`)

| File                  | Description                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importService.ts`    | Parses place lists from CSV, JSON, GeoJSON, KML/KMZ, and GPX formats. Handles Google Maps Takeout exports and extracts coordinates from URLs.                       |
| `exportService.ts`    | Serializes a list to CSV or GeoJSON (round-trips with the importer), plus a sanitized filename. Tombstoned places are omitted.                                      |
| `placeListMerge.ts`   | Deterministic, order-independent merge of two list replicas: LWW metadata (id tie-break), LWW places, tombstone-aware (no resurrection), dedupe of concurrent adds. |
| `listSyncService.ts`  | Gun-backed replication for SHARED lists only. Private lists write nothing. Room key per list with revoke-by-rotation; received replicas merge via the store.        |
| `shareService.ts`     | Builds/parses shareable place links — canonical universal links (`polarismaps.com/p/<id>`) with a coordinate fallback and a `polaris-maps://` scheme form.          |
| `placeDetailCache.ts` | Offline place-detail snapshot cache (SQLite, LRU-bounded, source-version precedence, canonical-key aliasing). See `deepen-search-and-places`.                       |

### Favorites (`src/services/favorites/`)

| File                  | Description                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `favoritesService.ts` | MMKV-backed favorites store for Home, Work, and pinned locations. Ordering logic keeps Home and Work at the top. |

### iCloud (`src/services/icloud/`)

| File                   | Description                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `iCloudSyncService.ts` | iOS-only iCloud Key-Value storage bridge via native `PolarisCloudStore` module. Availability checks, JSON serialization, pull/push operations. |

## Import Formats

| Format  | Source                      | Details                                 |
| ------- | --------------------------- | --------------------------------------- |
| CSV     | Google Maps Takeout, custom | Header row with name, lat/lng columns   |
| JSON    | Custom exports              | Array of `{name, lat, lng}` objects     |
| GeoJSON | GIS tools, Overture         | FeatureCollection with Point geometries |
| KML/KMZ | Google Earth, My Maps       | Placemarks with coordinates             |
| GPX     | GPS devices, fitness apps   | Waypoints with coordinates              |

## Related Files

- [`src/stores/placeListStore.ts`](../../stores/placeListStore.ts) — MMKV-persisted place lists with full CRUD, import, cross-list move, sharing state, and merge of remote replicas
- [`src/hooks/useICloudSync.ts`](../../hooks/useICloudSync.ts) — Pull on mount, debounce-push on change, merge on iCloud update
- [`app/(tabs)/places.tsx`](<../../../app/(tabs)/places.tsx>) — My Places tab with list management and file import
- [`app/places/list.tsx`](../../../app/places/list.tsx) — Place list detail with sort, edit, export/share, share toggle, and navigate-to-map
- [`app/p/[id].tsx`](../../../app/p/[id].tsx) — Inbound universal-link route resolving `polarismaps.com/p/<id>` to the place detail
- [`plugins/withUniversalLinks.js`](../../../plugins/withUniversalLinks.js) — Associated-domains entitlement plugin (AASA hosted out-of-repo)
