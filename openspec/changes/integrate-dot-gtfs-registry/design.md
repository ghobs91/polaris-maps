## Context

Polaris Maps currently uses the MobilityData catalog API for GTFS feed discovery (`transitFeedService.ts`), which requires an API token and returns feeds without guaranteed completeness. The DOT GTFS Feeds List (`src/services/transit/DOT_GTFS_Feeds_List.csv`) is a comprehensive US government registry of 1,194 unique transit agencies with verified GTFS download URLs — no API key needed.

The existing `gtfsStaticFetcher.ts` module contains well-tested ZIP extraction and CSV parsing logic, but it's limited to rail-only filtering and direct feed URLs. This design extends and generalizes that infrastructure to support the DOT registry as a primary US feed source.

The CSV schema:

| Column                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| NTD ID                 | Unique agency identifier (used for deduplication)     |
| Agency Name            | Full legal name                                       |
| City                   | Agency headquarters city                              |
| State                  | Two-letter state code                                 |
| Mode Name              | Mode description (Bus, Light Rail, Heavy Rail, etc.)  |
| Mode                   | GTFS mode abbreviation (MB, LR, HR, FB, etc.)         |
| UZA Name               | Urbanized Area name                                   |
| Primary UZA Population | Population of the primary UZA                         |
| Weblink                | GTFS .zip download URL (present for 1,514/1,552 rows) |

## Goals / Non-Goals

**Goals:**

- Index the DOT CSV at build time into a spatially-queryable structure bundled with the app
- Given a viewport bounding box, return matching DOT GTFS feeds with agency metadata and download URLs
- Download and parse GTFS `.zip` files from DOT URLs, converting to `TransitRouteLine[]` and `StopDepartureInfo` models
- Support all transit modes (bus, rail, subway, tram, ferry, cable car) — not just rail
- Show a non-blocking loading indicator while GTFS data downloads
- Pre-fetch and cache GTFS feeds when a user downloads a region for offline use

**Non-Goals:**

- No real-time GTFS data (GTFS-RT) — this change is static GTFS only
- No replacement of dedicated endpoints (MTA, MBTA, WMATA) — DOT is a fallback layer, not a replacement
- No server-side processing — all indexing happens at build time, all lookups happen on-device
- No trip planning via DOT GTFS — routing remains via OTP / Transitous

## Decisions

### Decision 1: Build-time spatial index as bundled JSON

The CSV has ~1,552 rows but no lat/lng coordinates — only City + State. At build time, we:

1. Parse the CSV and extract unique city+state pairs (~800)
2. Look up coordinates using the existing geonames SQLite database (already built by `scripts/build-geonames-sqlite.mjs`)
3. Deduplicate feeds by NTD ID + mode, preferring entries with valid URLs
4. Group feeds into 0.1° spatial buckets (matching the existing `TILE_SIZE` pattern)
5. Output `src/services/transit/dot-gtfs-index.json` as a bundled asset

**Rationale:** Pre-computing avoids runtime geocoding calls. The index is ~100KB (small enough to bundle). Rebuilding is a one-time build step (or re-run when the CSV updates). Using the existing geonames DB maintains consistency with the rest of the codebase.

**Alternative considered:** SQLite with R-tree. Rejected because it adds complexity for a read-only lookup of ~800 cities. A simple bucket-based JSON index is faster to query and easier to debug.

### Decision 2: Runtime lookup by viewport center + radius

Given a viewport bounding box:

1. Compute the center point: `centerLat = (minLat + maxLat) / 2`, `centerLng = (minLng + maxLng) / 2`
2. Calculate the search radius from the viewport diagonal: `radiusDeg = max(maxLat - minLat, maxLng - minLng) / 2 + 0.3` (adding 0.3° ~33km buffer)
3. Query the spatial index for buckets overlapping the search radius
4. Filter results: feeds within the radius or feeds whose UZA has population > threshold

Return deduplicated feeds sorted by UZA population (larger metros first).

**Rationale:** Center+radius is simpler and faster than bounding-box containment for point-based city data. The radius buffer ensures suburban feeds near the viewport edge are included. Population sorting prioritizes major transit systems.

### Decision 3: Extract shared GTFS parsing utilities

The `gtfsStaticFetcher.ts` contains robust ZIP extraction and CSV parsing but is coupled to rail-only filtering. We refactor:

**New shared module: `src/services/transit/gtfsParser.ts`**

- `extractZipTexts(buffer, fileNames)` — ZIP extraction (moved from gtfsStaticFetcher)
- `parseCsv(text)` — CSV parsing (moved from gtfsStaticFetcher)
- `parseGtfsFeed(files, options?)` — parses raw GTFS text files into `GtfsFeedData`
- `convertFeedToLines(feed, config)` — converts `GtfsFeedData` to `TransitRouteLine[]`

The existing `gtfsStaticFetcher.ts` imports from `gtfsParser.ts` instead of owning the logic. The new `dotGtfsFetcher.ts` also imports from `gtfsParser.ts`.

**Rationale:** Avoids duplicating ~400 lines of ZIP/CSV parsing. The shared module is testable in isolation. Existing callers are unaffected.

### Decision 4: DOT GTFS dispatch in the transit line pipeline

The `tryFetchViaOtp` function in `transitLineFetcher.ts` gains a new apiStyle: `dot-gtfs`. This is registered as a **catch-all US endpoint** — placed after all city-specific endpoints but before the Overpass fallback.

The dispatch flow becomes:

1. Dedicated endpoints (MTA `rest-v1`, MBTA `mbta-v3`, WMATA `wmata-v1`, etc.)
2. City-specific GTFS endpoints (`cta-gtfs-v1`, `septa-gtfs-v1`, etc.)
3. **DOT GTFS** ← NEW: queries the DOT index, downloads matching feeds
4. Transitous vector tiles (global, JS-side returns null)
5. Overpass API (universal fallback)

For step 3, the DOT fetcher:

1. Calls `lookupDotGtfsFeeds(centerLat, centerLng, radiusDeg)` → list of feed entries
2. Filters to feeds not already covered by a higher-priority endpoint (by checking if the viewport center falls within any dedicated endpoint's bbox)
3. Downloads up to 4 feeds concurrently (per the existing concurrency pattern)
4. Parses each feed via `parseGtfsFeed()` → `GtfsFeedData`
5. Converts to `TransitRouteLine[]` via `convertFeedToLines()` with mode filter `all` (not just rail)
6. Caches results in memory keyed by feed URL + TTL

### Decision 5: Loading indicator via transit store

New field in `transitStore`:

```typescript
gtfsLoadingAgency: string | null; // null = not loading, string = "King County Metro" or "MBTA + 2 others"
```

Set at the start of `fetchDotGtfsLines()` and cleared when all downloads complete. The `TransitLayer.tsx` component renders a translucent banner at the top of the map:

```
┌─────────────────────────────────┐
│ ⬇ Loading transit data from     │
│   MTA New York City Transit...  │
└─────────────────────────────────┘
```

The banner auto-dismisses after 15 seconds even if download continues (to avoid persistent UI clutter).

### Decision 6: Offline map GTFS pre-caching

When a user downloads a region for offline use, the download process queries the DOT index for feeds covering the region's bounding box and pre-fetches + parses + persists the GTFS data. Parsed data is stored in the offline SQLite database alongside vector tiles.

The offline transit data includes:

- Route geometries (for map rendering)
- Stop locations (for stop display)
- Stop times (for departure estimation, using scheduled times when offline)
- Agency metadata (for display)

## Data Flow

```
User pans map (transit layer ON)
        │
        ▼
useTransitStops.ts → fetchTransitLines(viewport)
        │
        ▼
tryFetchViaOtp(viewport center)
        │
        ├─ Dedicated endpoints found? → YES: use those
        │
        ├─ City-specific GTFS? → YES: use those
        │
        ├─ DOT GTFS lookup ← NEW
        │     │
        │     ├─ lookupDotGtfsFeeds(center, radius)
        │     │     └─ queries dot-gtfs-index.json spatial buckets
        │     │
        │     ├─ Filter out already-covered feeds
        │     │
        │     ├─ Set gtfsLoadingAgency = "Agency Name (+ N others)"
        │     │
        │     ├─ Parallel download (max 4 concurrent)
        │     │     └─ fetch(url) → arrayBuffer → extractZipTexts → parseGtfsFeed
        │     │
        │     ├─ convertFeedToLines(feed, { routeTypeFilter: ALL })
        │     │
        │     ├─ Cache results in memory
        │     │
        │     └─ Clear gtfsLoadingAgency
        │
        ├─ Transitous? → null (tiles handle rendering)
        │
        └─ Overpass fallback
```

## Risks / Trade-offs

- **GTFS URL stability**: DOT feed URLs can change or go stale → Mitigation: the CSV is updated periodically by DOT; we ship updates as app updates. Failed downloads are silently skipped.
- **Feed size**: Some GTFS zips are 50MB+ (e.g., NYC MTA) → Mitigation: limit concurrent downloads to 2 for feeds >10MB; use `fetch` with `Accept-Encoding: gzip` and 60s timeout.
- **City center approximation**: A feed for "Seattle" may cover suburbs 50km away, but our radius lookup might miss it if the user pans to Tacoma → Mitigation: use a generous lookup radius (100km + UZA population boost) to include metro-area feeds.
- **Duplicate coverage**: A city may have both a dedicated endpoint AND DOT coverage → Mitigation: the priority chain ensures dedicated endpoints win. DOT only fires for uncovered areas.
- **CSV updates**: DOT publishes new CSV versions periodically → Mitigation: document the update process. The build script can download the latest CSV from the DOT website.

## Open Questions

- Should we cache parsed GTFS data to disk (AsyncStorage/SQLite) to survive app restarts, or is in-memory sufficient? (Leaning toward in-memory for v1, with the same TTL pattern as existing feed cache.)
- Should we support user-initiated refresh of DOT feeds for a given area? (Could be a follow-up feature.)
- The DOT CSV has a `Date Validated` column — should we use this to skip stale feeds (>1 year old)? (Probably yes, unless no fresher feed exists for the area.)
