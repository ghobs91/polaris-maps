## Context

Polaris Maps uses `findEndpointForCoords()` to match the user's viewport center to the first overlapping bounding box in `OTP_ENDPOINTS`. When a match is found, `tryFetchViaOtp` dispatches to the appropriate fetcher based on `apiStyle`. City-specific GTFS styles (e.g., `cta-gtfs-v1`, `idfm-gtfs-v1`) are handled by `GTFS_CONFIGS[ep.apiStyle]`, which drives `fetchGtfsStaticLines()` — a config-driven downloader that fetches a GTFS ZIP, parses it via `gtfsParser.ts`, and returns `TransitRouteLine[]`.

The DOT GTFS Registry already covers the US as a catch-all. Europe currently has only city-level coverage (TfL London, IDFM Paris, VBB Berlin, CRTM Madrid) plus Entur Norway for routing/departures (no line geometry). This leaves most of Europe — Copenhagen, Helsinki, Stockholm, Amsterdam, Dublin, Zurich, Tallinn, Luxembourg City, plus all rural/small-city transit — uncovered, falling through to slow Overpass API queries.

`data.public-transport.earth` provides consolidated, country-level GTFS ZIPs for 10 European countries. Each feed is a single ZIP containing all transit agencies for that country. No API key is required.

## Goals / Non-Goals

**Goals:**

- Register 10 European country-level GTFS feeds (`de`, `dk`, `fi`, `ee`, `ie`, `lu`, `nl`, `no`, `se`, `ch`) as first-class entries in `OTP_ENDPOINTS`
- Place country entries after existing city-specific European endpoints but before Entur Norway, ensuring city endpoints win at city level while country feeds cover the rest
- Include **all** transit modes (bus, rail, tram, metro, ferry, cable car, gondola, funicular) since these are consolidated country-wide feeds — not just rail
- Reuse the existing `gtfs-static-v1` config-driven pipeline (`GTFS_CONFIGS` → `fetchGtfsStaticLines` → `gtfsParser.ts`) with zero new parsing or fetching code
- Set appropriate timeouts for large country-level ZIPs (60s default, configurable per country)

**Non-Goals:**

- No new GTFS parsing code — `gtfsParser.ts` handles all format details
- No changes to the dispatch chain logic — the existing `gtfsConfig` branch in `tryFetchViaOtp` automatically handles new apiStyle values
- No changes to routing or departure fetching — these feeds provide line geometry only
- No offline pre-caching for European feeds (follow-up work, matching DOT GTFS offline pattern)
- No removal of existing city-specific European endpoints

## Decisions

### Decision 1: Individual apiStyle per country (not a single shared style)

Each country gets its own `OtpApiStyle` value (e.g., `de-gtfs-v1`, `dk-gtfs-v1`, etc.) and its own entry in both `OTP_ENDPOINTS` and `GTFS_CONFIGS`.

**Rationale:** Individual apiStyles enable per-country persistent caching (the cache key uses the endpoint label), independent cache expiration, and clear logging per country. A single shared style would cause cache collisions when panning between countries.

**Alternative considered:** Single `europe-gtfs-v1` style with URL override. Rejected — would cause all 10 country caches to collide under one key, and per-country timeout tuning would be impossible.

### Decision 2: `filterByRouteType: false` — include all transit modes

Each country config uses `filterByRouteType: false` so the GTFS parser includes buses, trams, metros, ferries, and all other transit modes.

**Rationale:** These are consolidated national feeds. Including only rail modes (like some US city configs do) would discard 80%+ of European transit lines. The Overpass fallback only returns rail-type routes, so GTFS adds unique bus/tram coverage that would otherwise be invisible.

**Alternative considered:** Filter to specific route types per country. Rejected — adds complexity for no benefit. Users in Copenhagen want to see buses too.

### Decision 3: Placement order in OTP_ENDPOINTS — after city endpoints, before Entur

The 10 country entries are inserted in the `OTP_ENDPOINTS` array after existing European city endpoints (TfL, IDFM, VBB, Madrid) but before Entur Norway:

```
... (US endpoints)
TfL London              (city-level, tfl-v1)
IDFM Paris              (city-level, idfm-gtfs-v1)
VBB Berlin              (city-level, vbb-gtfs-v1)
CRTM Madrid             (city-level, madrid-gtfs-v1)
--- NEW ENTRIES HERE ---
Germany (de-gtfs-v1)    (nationwide)
Denmark (dk-gtfs-v1)    (nationwide)
Finland (fi-gtfs-v1)    (nationwide)
Estonia (ee-gtfs-v1)    (nationwide)
Ireland (ie-gtfs-v1)    (nationwide)
Luxembourg (lu-gtfs-v1) (nationwide)
Netherlands (nl-gtfs-v1)(nationwide)
Norway (no-gtfs-v1)     (nationwide)
Sweden (se-gtfs-v1)     (nationwide)
Switzerland (ch-gtfs-v1)(nationwide)
--- END NEW ENTRIES ---
Entur Norway            (nationwide, transmodel-v3)
DOT GTFS Registry (US)  (catch-all, dot-gtfs)
Transitous (global)     (final fallback)
```

`findEndpointForCoords` returns the first matching bbox. For Berlin, VBB's smaller bbox matches before Germany's nationwide bbox. For Hamburg, VBB doesn't match but Germany does. This naturally prioritizes dedicated endpoints without any special-cased dispatch logic.

**Entur Norway overlap:** Norway has both a GTFS feed entry (`no-gtfs-v1`) and an Entur routing entry (`transmodel-v3`). Since the GTFS entry is placed before Entur, `findEndpointForCoords` returns the GTFS entry for any point in Norway. Analysis shows no functional loss:

- `searchOtpStops()` returns empty for transmodel-v3 anyway (no OTP1 REST stops index)
- `fetchOtpRoutesAtStop()` / `fetchOtp1Stoptimes()` only work with rest-v1
- `preloadOtpStops()` does nothing for transmodel-v3

Entur routing is handled separately in `transitRoutingService.ts` (which uses its own endpoint lookup logic, not `findEndpointForCoords`).

**Alternative considered:** Place Norway GTFS after Entur with a special fallthrough in `tryFetchViaOtp`. Rejected — adds dispatch complexity for one country.

### Decision 4: National bounding boxes — generous but not overlapping

Each country gets a bounding box that covers its full sovereign territory plus coastal waters (ferries). Bounding boxes are slightly larger than strict geographic bounds to include island territories (e.g., Danish islands, Finnish archipelago, Norwegian Svalbard area truncated).

| Country          | bbox                        |
| ---------------- | --------------------------- |
| Germany (de)     | `[47.2, 5.8, 55.1, 15.1]`   |
| Denmark (dk)     | `[54.5, 7.5, 57.8, 15.5]`   |
| Finland (fi)     | `[59.5, 19.0, 70.1, 31.6]`  |
| Estonia (ee)     | `[57.5, 21.5, 59.7, 28.2]`  |
| Ireland (ie)     | `[51.4, -10.5, 55.4, -5.5]` |
| Luxembourg (lu)  | `[49.4, 5.7, 50.2, 6.5]`    |
| Netherlands (nl) | `[50.7, 3.3, 53.6, 7.3]`    |
| Norway (no)      | `[57.5, 4.0, 71.2, 31.5]`   |
| Sweden (se)      | `[55.3, 10.5, 69.1, 24.2]`  |
| Switzerland (ch) | `[45.8, 5.9, 47.8, 10.5]`   |

**Rationale:** National boundaries are unambiguous. Using proper bounding boxes avoids serving wrong-country data. Minimal overlap between neighboring countries is acceptable — the user's center point determines which feed is fetched (fast visual feedback is preferred over avoiding one extra feed query).

### Decision 5: Feed URL pattern — direct GTFS ZIP download

All country feeds follow the URL pattern: `https://data.public-transport.earth/gtfs/{country_code}`.

**Rationale:** The service redirects to the actual GTFS ZIP. No pagination, no API key, no authentication. This is simpler than the DOT GTFS Registry (which requires spatial indexing) or MobilityData (which requires an API token).

### Decision 6: Timeout tuning — 90s for large countries

Country-level GTFS ZIPs can be large (Germany's may be 200MB+). The default `fetchGtfsStaticLines` timeout is 40s. Country configs use a higher timeout:

| Country        | timeoutMs | Rationale                     |
| -------------- | --------- | ----------------------------- |
| de, nl, se, ch | 90_000    | Large, dense transit networks |
| dk, fi, no, ie | 60_000    | Medium density                |
| ee, lu         | 45_000    | Small countries, small feeds  |

**Rationale:** Prevents premature timeout on slow mobile connections while downloading large GTFS archives. Failed downloads are silently skipped.

## Data Flow

```
User pans map over Copenhagen (transit layer ON)
        │
        ▼
fetchTransitLines(viewport)
        │
        ▼
tryFetchViaOtp(center: 55.67, 12.57)
        │
        ├─ findEndpointForCoords(55.67, 12.57)
        │     ├─ TfL London? NO (lat 51.2-51.75)
        │     ├─ IDFM Paris? NO (lat 48.7-49.0)
        │     ├─ VBB Berlin? NO (lat 52.3-52.7)
        │     ├─ CRTM Madrid? NO (lat 40.25-40.6)
        │     ├─ Germany? NO (lat 47.2-55.1, 12.57 is within lng but lat out of range for Copenhagen)
        │     ├─ Denmark (dk)? YES ✓ (lat 55.67 within 54.5-57.8, lng 12.57 within 7.5-15.5)
        │     └─ Returns: { label: 'Denmark GTFS', apiStyle: 'dk-gtfs-v1', url: 'https://data.public-transport.earth/gtfs/dk' }
        │
        ├─ GTFS_CONFIGS['dk-gtfs-v1'] → { label: 'Denmark GTFS', filterByRouteType: false, timeoutMs: 60000 }
        │
        ├─ fetchGtfsStaticLines({ ...config, feedUrl: ep.url })
        │     ├─ Check persistent cache (MMKV, 7-day TTL)
        │     ├─ Check in-memory cache (session)
        │     ├─ fetch(https://data.public-transport.earth/gtfs/dk, { timeout: 60s })
        │     ├─ extractZipTexts() → { routes.txt, trips.txt, stops.txt, shapes.txt, stop_times.txt }
        │     ├─ parseGtfsFeed() → GtfsFeedData
        │     ├─ convertFeedToLines(feed, { filterByRouteType: false }) → TransitRouteLine[]
        │     ├─ Save to persistent cache
        │     └─ Return lines (buses, trains, metro, ferries — all modes)
        │
        └─ Return lines → cached → displayed on map
```

## Risks / Trade-offs

- **Large ZIP download size:** Germany's GTFS may be 200MB+, causing slow downloads on cellular → Mitigation: 90s timeout, persistent 7-day cache (downloaded once per week), yield to UI thread during parsing. Falls back to Overpass if download fails.
- **URL stability:** `data.public-transport.earth` is a community service; URLs could change or go offline → Mitigation: failed downloads silence the error and fall through to Overpass. URLs are simple enough to update in config.
- **Duplicate coverage:** Neighboring country bboxes may overlap. Panning near borders could fetch GTFS for both countries → Mitigation: acceptable. The center point matches one country; panning slightly changes which feed is fetched. Both results are cached.
- **Entur routing coexistence:** Norway GTFS entry is placed before Entur in `OTP_ENDPOINTS`, so `findEndpointForCoords` returns the GTFS entry for all points in Norway. → Mitigation: Entur routing uses a separate lookup in `transitRoutingService.ts` and is unaffected. Stop search and departure functions already return empty for transmodel-v3.
- **Bus density:** Country feeds include all bus stops, which can produce dense stop clusters on the map → Mitigation: the existing transit layer rendering already handles stop density via clustering thresholds. No code changes needed.

## Open Questions

- Should we add `fr` (France) and `gb` (UK) feeds as well? These have city-level coverage (IDFM Paris, TfL London) but lack national line geometry. (Leaning toward separate follow-up change.)
- Should country feed entries provide a `stopsIndexUrl` for station search? The feeds include `stops.txt` — could be indexed locally for offline station search. (Out of scope for v1.)
