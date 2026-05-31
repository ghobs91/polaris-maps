## Context

The transit map layer currently serves four regions reliably via dedicated APIs:

| Region    | API Style       | Fetcher                   | Data Source         |
| --------- | --------------- | ------------------------- | ------------------- |
| NYC Metro | `rest-v1`       | `fetchOtpLines()`         | MTA OTP (CamSys)    |
| Boston    | `mbta-v3`       | `fetchMbtaLines()`        | MBTA V3 JSON:API    |
| Portland  | `rest-v1`       | `fetchOtpLines()`         | TriMet OTP          |
| Norway    | `transmodel-v3` | (none, Overpass fallback) | Entur Transmodel V3 |

All other US and European cities fall back to Overpass QL queries (`fetchTile()`), which use `out body geom` on OSM route relations. These queries are unreliable on mobile for dense metro areas — typical payloads reach 5–10 MB per tile, and the 25s Overpass server timeout frequently truncates results. This explains the reported symptoms: Chicago showing nothing, WMATA/SEPTA showing only 1 line.

The dispatch logic lives in `tryFetchViaOtp()` (`transitLineFetcher.ts`):

```typescript
async function tryFetchViaOtp(...): Promise<TransitRouteLine[] | null> {
  const ep = findEndpointForCoords(centreLat, centreLng);
  if (!ep) return null;

  if (ep.apiStyle === 'mbta-v3') {
    const lines = await fetchMbtaLines();
    if (lines.length === 0) return null;
    return lines;
  }

  if (ep.apiStyle !== 'rest-v1') return null;  // <-- unknown styles → fall through to Overpass
  const lines = await fetchOtpLines(ep);
  ...
}
```

Unknown `apiStyle` values silently fall through to Overpass. We need to add new styles and corresponding fetcher branches.

## Goals / Non-Goals

**Goals:**

- Add dedicated API endpoints for the 8 largest US transit systems currently relying on Overpass
- Add dedicated API endpoints for the 4 largest European metro systems
- Each endpoint uses the most reliable public API available for that agency
- Follow the established `mbtaFetcher.ts` pattern: `cachedLines` singleton, `fetchInFlight` dedup, batched concurrent requests, permanent in-memory cache
- Keep the existing OTP endpoints unchanged (NYC, Portland, Boston, Norway)
- Overpass remains as a universal safety net for cities without any endpoint

**Non-Goals:**

- No real-time departure data for new endpoints (route lines only, matching existing Overpass behavior)
- No on-device GTFS bundle (adds app size; keep network-based for now)
- No server-side proxy/caching layer
- No changes to the `TransitRouteLine` data model
- No changes to the rendering layer (TransitLayer.tsx, MapView, etc.)

## Decisions

### Decision 1: API style per agency

Each agency gets a new `apiStyle` identifier and a dedicated fetcher module. The choice of API is determined by what each agency publicly offers:

| City          | Agency       | apiStyle            | API Type        | Public? | Key Required? |
| ------------- | ------------ | ------------------- | --------------- | ------- | ------------- |
| Washington DC | WMATA        | `wmata-v1`          | REST/JSON       | Yes     | Yes (free)    |
| Chicago       | CTA          | `cta-gtfs-v1`       | GTFS Static     | Yes     | No            |
| SF Bay Area   | BART         | `bart-v1`           | REST/JSON       | Yes     | No            |
| Philadelphia  | SEPTA        | `septa-gtfs-v1`     | GTFS Static     | Yes     | No            |
| Los Angeles   | LACMTA       | `lametro-gtfs-v1`   | GTFS Static     | Yes     | No            |
| Atlanta       | MARTA        | `marta-gtfs-v1`     | GTFS Static     | Yes     | No            |
| Miami         | MDT          | `miami-gtfs-v1`     | GTFS Static     | Yes     | No            |
| Baltimore     | MTA Maryland | `baltimore-gtfs-v1` | GTFS Static     | Yes     | No            |
| London        | TfL          | `tfl-v1`            | TfL Unified API | Yes     | No (free)     |
| Paris         | IDFM         | `idfm-gtfs-v1`      | GTFS Static     | Yes     | No            |
| Berlin        | VBB          | `vbb-gtfs-v1`       | GTFS Static     | Yes     | No            |
| Madrid        | CRTM         | `madrid-gtfs-v1`    | GTFS Static     | Yes     | No            |

**Rationale (REST vs GTFS):**

**WMATA and BART get REST fetchers** because they have well-documented REST APIs that return polylines directly — the fastest, simplest path to route lines. Their patterns closely match the MBTA V3 approach.

**CTA and other US agencies use GTFS Static** because:

- CTA's Train Tracker API requires a key with rate limits and only returns stop-level data, not line geometry
- GTFS feeds include `shapes.txt` with full polyline geometry AND `stops.txt` with station coordinates
- GTFS is universally available (every US transit agency publishes it), making the approach reusable
- A single `GtfsStaticFetcher` class can serve all GTFS-based cities with agency-specific config (feed URL, route type filter, agency name mapping)

**TfL gets a REST fetcher** because their unified API is comprehensive, free, and returns excellent polyline data.

**European agencies use GTFS Static** because GTFS is the lingua franca of transit data in Europe too, and avoids dealing with a dozen different agency APIs.

### Decision 2: Shared GTFS Static fetcher

Rather than write 8 separate fetcher files, create a single `GtfsStaticFetcher` that accepts per-agency configuration:

```typescript
interface GtfsFetcherConfig {
  label: string; // e.g. "CTA Chicago"
  feedUrl: string; // e.g. "https://www.transitchicago.com/downloads/sch_data/google_transit.zip"
  routeTypeFilter: number[]; // e.g. [1] for subway, [0,1] for light_rail+subway
  agencyNameMap?: Record<string, string>; // map GTFS agency names to display names
  modeMap?: Record<number, TransitMode>; // map GTFS route_type to TransitMode
  timeoutMs?: number;
}
```

A single `fetchGtfsStaticLines(config)` function:

1. Fetches the GTFS zip from `feedUrl`
2. Reads `shapes.txt`, `trips.txt`, `routes.txt`, `stops.txt`, `stop_times.txt` in-memory
3. Filters routes by `routeTypeFilter`
4. Matches shapes to routes via trips
5. Returns `TransitRouteLine[]`

**Why not bundle GTFS data in the app?** GTFS feeds are typically 5–15 MB compressed and change quarterly. Bundling would add significant app size and stale data. Network fetch with permanent cache (like OTP/MBTA patterns) keeps the app lean while ensuring fresh data.

### Decision 3: Dispatch pattern

The `tryFetchViaOtp` function gains a switch/map that dispatches each `apiStyle` to its fetcher:

```typescript
const STYLE_FETCHERS: Record<string, () => Promise<TransitRouteLine[]>> = {
  'mbta-v3': fetchMbtaLines,
  'wmata-v1': fetchWmataLines,
  'bart-v1': fetchBartLines,
  'tfl-v1': fetchTflLines,
  'cta-gtfs-v1': () => fetchGtfsStaticLines(CTA_GTFS_CONFIG),
  'septa-gtfs-v1': () => fetchGtfsStaticLines(SEPTA_GTFS_CONFIG),
  // ... etc.
};

if (ep.apiStyle in STYLE_FETCHERS) {
  const lines = await STYLE_FETCHERS[ep.apiStyle]();
  if (lines.length === 0) return null;
  return lines;
}

if (ep.apiStyle !== 'rest-v1') return null;
return fetchOtpLines(ep);
```

This way, any `apiStyle` not explicitly handled still falls through to Overpass (safe default).

### Decision 4: Bounding boxes

Each endpoint entry needs a bbox that covers the agency's service area. These are derived from the agency's published service boundaries:

| Endpoint        | Bbox `[minLat, minLon, maxLat, maxLon]` |
| --------------- | --------------------------------------- |
| WMATA DC        | `[38.75, -77.5, 39.2, -76.8]`           |
| CTA Chicago     | `[41.6, -88.0, 42.1, -87.5]`            |
| BART SF         | `[37.4, -122.6, 38.1, -121.7]`          |
| SEPTA Philly    | `[39.8, -75.4, 40.2, -74.9]`            |
| LA Metro        | `[33.7, -118.5, 34.2, -117.9]`          |
| MARTA Atlanta   | `[33.6, -84.6, 33.9, -84.2]`            |
| Miami Metrorail | `[25.6, -80.5, 25.9, -80.1]`            |
| Baltimore       | `[39.15, -76.8, 39.45, -76.4]`          |
| London TfL      | `[51.2, -0.6, 51.75, 0.3]`              |
| Paris IDFM      | `[48.7, 2.0, 49.0, 2.6]`                |
| Berlin VBB      | `[52.3, 13.0, 52.7, 13.8]`              |
| Madrid CRTM     | `[40.25, -3.9, 40.6, -3.4]`             |

### Decision 5: Overpass hardening (safety net)

Even with dedicated endpoints, some cities won't have coverage. The Overpass fallback must be reliable as a universal safety net. Prior work already implemented three improvements:

- **POST instead of GET** — avoids URL length limits for large queries
- **60s server timeout** — gives Overpass enough time to process dense metro areas
- **75s client timeout** — gives mobile networks headroom
- **3-retry exponential backoff** — handles transient failures
- **`console.warn/console.error` logging** — makes failures visible during development/debugging

## Risks / Trade-offs

- **GTFS feed availability**: Some agencies rate-limit or rotate their GTFS URLs → Mitigation: use known-stable URLs (Transitland, MobilityData, agency CDN). For agencies with volatile URLs, provide a configurable override via environment variable.
- **GTFS feed size**: Chicago CTA GTFS is ~8 MB compressed → Mitigation: cache permanently in memory like OTP lines. First fetch adds ~2–4 seconds but only happens once per session.
- **GTFS parsing overhead**: Parsing shapes.txt with thousands of rows in JavaScript is CPU-intensive → Mitigation: use `TextDecoder` with streaming line-by-line parsing rather than loading the entire file. Batch parse on a short timeout to yield to the UI thread.
- **API key management**: WMATA requires an API key → Mitigation: store via `EXPO_PUBLIC_` env var, same pattern as `EXPO_PUBLIC_MBTA_API_KEY`. Provide clear setup instructions in the endpoint configuration.
- **European GTFS availability**: Not all European agencies publish direct GTFS download links → Mitigation: use Transitland's aggregated feed registry as a stable proxy. Fall back to Overpass if unavailable.
- **bbox overlap**: Two endpoints with overlapping bboxes (e.g., WMATA and Baltimore) could cause the wrong endpoint to be selected → Mitigation: `findEndpointForCoords` returns the first match. Order endpoints from smallest to largest bbox in the registry so fine-grained endpoints (Baltimore) take priority over coarse ones (WMATA).

## Open Questions

- Should we add region-to-endpoint mapping so that zoomed-out views (where the viewport center isn't over any city) still trigger the correct fetcher? Current `findEndpointForCoords` only checks the center point, which is fine for zoomed-in use but may miss coverage at zoomed-out levels.
- Should the TransitLayer show a loading indicator per-tile or per-city? Currently only a global spinner exists.
