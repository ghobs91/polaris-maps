## Why

Polaris Maps currently discovers GTFS feeds through the MobilityData catalog (`transitFeedService.ts`), which requires an API key (`EXPO_PUBLIC_MOBILITY_DB_REFRESH_TOKEN`) and only returns feeds alphabetically near a coordinate — with no structural understanding of US transit agencies. The DOT GTFS Feeds List (`DOT_GTFS_Feeds_List.csv`) is a comprehensive, publicly-available registry maintained by the US Department of Transportation containing 1,552 rows across ~1,194 unique transit agencies nationwide, with verified GTFS download URLs for 1,514 entries.

This registry is a superior source for US transit coverage:

- **No API key required** — it's a static CSV file, hosted locally in the app bundle
- **Complete US coverage** — every FTA-reporting transit agency, including rural and tribal operators that MobilityData may not index
- **Structured metadata** — city, state, UZA population, mode type, and NTD ID for deduplication
- **Verification flags** — each feed is certified and date-validated by DOT

Currently, when a user pans to a US city without a dedicated endpoint (e.g., Denver, Phoenix, Minneapolis, Dallas), the app falls back to Overpass API — which is slow, unreliable, and only provides OSM-based rail geometry (no bus lines, no schedules). This change makes the DOT registry the primary US feed discovery mechanism, replacing the external MobilityData dependency for all domestic transit.

## What Changes

- **Bundle and index the DOT GTFS Feeds List** — pre-process the CSV at build time into a spatially-queryable SQLite or JSON index stored in the app bundle, mapping lat/lng → matching agency feeds
- **Create a DOT GTFS feed lookup service** — given a bounding box or city coordinate, return the list of relevant GTFS feed URLs (filterable by mode: rail, bus, ferry, etc.)
- **Build a GTFS download + parse pipeline** — fetch relevant GTFS `.zip` files, extract `routes.txt`, `shapes.txt`, `trips.txt`, `stop_times.txt`, and `stops.txt`, converting them to the existing `TransitRouteLine` and `StopDepartureInfo` models
- **Integrate into the transit dispatch chain** — add a `dot-gtfs` branch in `tryFetchViaOtp` that queries the DOT registry before falling back to Overpass
- **Add a loading indicator** — surface a "Loading transit data from [Agency Name]..." status to the user via the transit store while feeds are downloading and parsing
- **Offline map support** — when a user downloads a region for offline use, pre-fetch and cache the DOT GTFS feeds that cover that region

## Capabilities

### New Capabilities

- `dot-gtfs-index`: Build-time pipeline that processes `DOT_GTFS_Feeds_List.csv` into a spatially-indexed lookup structure (SQLite with R-tree or pre-bucketed GeoJSON), included in the app bundle
- `dot-gtfs-lookup`: Runtime service that accepts a lat/lng bounding box and returns matching GTFS feed entries with metadata (agency name, modes, GTFS URL, city, state)
- `dot-gtfs-fetch`: Downloads, unzips, and parses GTFS static data from DOT-listed feeds, reusing the existing `extractZipTexts()` and `parseCsv()` utilities from `gtfsStaticFetcher.ts`
- `dot-gtfs-lines`: Converts parsed GTFS route + shape + stop data into `TransitRouteLine[]` with proper mode mapping (all modes: bus, rail, subway, tram, ferry, cable car)
- `dot-gtfs-loading-state`: New store field `gtfsLoadingAgency: string | null` rendered as a non-blocking toast/banner while feeds load

### Modified Capabilities

- `transit-line-fetcher`: `tryFetchViaOtp` gains a `dot-gtfs` apiStyle dispatch branch that queries the DOT registry for the current viewport and fetches matching GTFS feeds
- `offline-map-download`: Extended to include GTFS feed pre-caching when a region is downloaded

## Impact

- `src/services/transit/DOT_GTFS_Feeds_List.csv` — existing file (already in repo), no change needed
- `src/services/transit/dotGtfsIndex.ts` — new module: spatial index builder (build-time) + runtime lookup
- `src/services/transit/dotGtfsFetcher.ts` — new module: downloads, parses, and caches GTFS feeds from DOT URLs
- `src/services/transit/gtfsStaticFetcher.ts` — refactor to extract shared parsing logic (`extractZipTexts`, `parseCsv`, `convertFeedToLines`) so DOT fetcher can reuse them
- `src/services/transit/transitLineFetcher.ts` — add `dot-gtfs` dispatch in `tryFetchViaOtp`
- `src/stores/transitStore.ts` — add `gtfsLoadingAgency` field and setter
- `src/components/map/TransitLayer.tsx` — render loading indicator when `gtfsLoadingAgency` is non-null
- `scripts/build-dot-gtfs-index.mjs` — build-time script to generate the spatial index from the CSV
- `app.json` / `.env.example` — add `EXPO_PUBLIC_DOT_GTFS_ENABLED` flag (default `true`)
