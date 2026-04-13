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

| File               | Description                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `importService.ts` | Parses place lists from CSV, JSON, GeoJSON, KML/KMZ, and GPX formats. Handles Google Maps Takeout exports and extracts coordinates from URLs. |

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

- [`src/stores/placeListStore.ts`](../../stores/placeListStore.ts) — MMKV-persisted place lists with full CRUD, import, cross-list move, and iCloud sync merge
- [`src/hooks/useICloudSync.ts`](../../hooks/useICloudSync.ts) — Pull on mount, debounce-push on change, merge on iCloud update
- [`app/(tabs)/places.tsx`](<../../../app/(tabs)/places.tsx>) — My Places tab with list management and file import
- [`app/places/list.tsx`](../../../app/places/list.tsx) — Place list detail with sort, edit, and navigate-to-map
