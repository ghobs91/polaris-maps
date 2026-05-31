## Context

Polaris Maps currently fetches transit route lines through three independent pipelines:

1. **City-specific REST APIs** (OTP `rest-v1`, MBTA `mbta-v3`, WMATA, BART, TfL) — dedicated fetcher modules
2. **GTFS Static feeds** (CTA, SEPTA, LA Metro, MARTA, Miami, Baltimore, Paris, Berlin, Madrid) — download ZIP, parse CSV, build geometry
3. **Overpass API** (universal fallback) — query OSM route relations with `out body geom`

Transitous provides a fourth option: a unified **MOTIS 2 API** at `https://api.transitous.org/api/` backed by a global dataset of GTFS feeds refreshed daily. It also serves a **MapLibre-compatible vector tile endpoint** with pre-rendered transit lines, stops, and real-time vehicle positions.

## Goals / Non-Goals

**Goals:**

- Use Transitous as the **primary** transit data source for all regions, falling back to city-specific endpoints only when Transitous lacks coverage for a given area
- Expose Transitous transit lines via its MapLibre vector tile endpoint — zero JS processing, instant rendering, covers the entire planet
- Route journey planning through Transitous MOTIS `/trip` endpoint, mapped to the existing `OtpItinerary` model
- Fetch real-time/scheduled departures via `/stop_event` endpoint
- Keep all existing fetchers operational as fallbacks — Transitous is additive, not destructive

**Non-Goals:**

- No local MOTIS instance — all requests go to `api.transitous.org`
- No replacement of the existing `TransitRouteLine` data model — vector tiles are a separate rendering path; existing lines from city-specific endpoints continue to work
- No GBFS / on-demand integration in this phase
- No vehicle position display (could be a follow-up)

## Decisions

### Decision 1: Transit lines via vector tiles, not API fetcher

Transitous serves a MapLibre vector tile source at `https://api.transitous.org/map/mapbox-gl-rt/` that includes transit route geometry pre-rendered at all zoom levels. We add this as a `MapLibreGL.VectorSource` style layer directly in the map, rather than fetching geometry via API and building GeoJSON on the JS thread.

**Rationale:**

- **Zero processing**: No JS-thread JSON parsing, no geometry building, no Douglas-Peucker simplification. The tiles render instantly via GPU.
- **Global coverage**: All regions Transitous covers (thousands of transit systems) are available automatically — no per-city configuration.
- **Auto-updating**: Feeds are refreshed daily by Transitous. Polaris Maps gets fresh data without rebuilding.
- **Progressive detail**: The tile server provides appropriate detail at each zoom level.
- **Existing pipeline preserved**: City-specific endpoints (`wmata-v1`, `bart-v1`, `tfl-v1`, etc.) continue to provide `TransitRouteLine[]` on the JS side. Tiles and JS lines can coexist in the same layer.

**Alternative considered:** Fetch route geometry via MOTIS REST API and build GeoJSON. Rejected because it re-creates the same JS-thread bottleneck we're trying to eliminate, and doesn't scale to global coverage.

### Decision 2: Routing via MOTIS `/trip`

Replace OTP routing with MOTIS routing via the Transitous endpoint. The `planTransitTrip` function in `transitRoutingService.ts` gains a branch that calls `POST /trip` with origin/destination coordinates, then maps the MOTIS response to `OtpItinerary[]`.

**Mapping:**
| MOTIS field | Polaris Model |
|-------------|---------------|
| `legs[].from.stop_id` / `from.name` / `from.lat` / `from.lon` | `OtpItinerary.legs[].from` |
| `legs[].to` | `OtpItinerary.legs[].to` |
| `legs[].mode` (walk, transit, etc.) | `LegMode` (WALK, SUBWAY, RAIL, etc.) |
| `legs[].duration` / `.start_time` / `.end_time` | `OtpItinerary.legs[].duration/startTime/endTime` |
| `legs[].transit.route.short_name / color / type` | `route.shortName / color / mode` |
| `legs[].transit.headsign` | `headsign` |
| `legs[].transit.intermediateStops` | `intermediateStops[]` |
| `legs[].geometry` (encoded polyline) | `legGeometry.points` |
| `trip.duration / start / end` | `OtpItinerary.duration/start/end` |

### Decision 3: Departures via MOTIS `/stop_event`

Fetch real-time departure boards via `POST /stop_event` with a station ID and time window. Map to the existing `StopDepartureInfo` model.

### Decision 4: Global bbox for endpoint registry

The Transitous endpoint gets a bounding box covering the entire world: `[-90, -180, 90, 180]`. Since `findEndpointForCoords` returns the first match, Transitous is placed **last** in the registry — after all city-specific endpoints. This means:

- NYC, Boston, Portland: matched by their `rest-v1`/`mbta-v3` bboxes first (faster, dedicated infra)
- DC, Chicago, SF, Philly, etc.: matched by their city-specific bboxes first (no API keys needed for GTFS)
- Everywhere else: matched by Transitous global bbox (universal coverage)

The `tryFetchViaOtp` dispatcher handles the `"transitous-v1"` apiStyle by returning `null` (skip JS-side line fetching) when using tiles. But for routing and departures, the `transitousClient.ts` module is called directly.

### Decision 5: MapLibre tile source configuration

The Transitous tile source is added in `TransitLayer.tsx` as an additional `MapLibreGL.VectorSource` with a style layer. The tile URL follows the pattern `https://api.transitous.org/map/mapbox-gl-rt/{z}/{x}/{y}.mvt`. We use MapLibreGL's built-in style expressions to render transit routes by their tile properties (color, route name, mode).

## Risks / Trade-offs

- **Service availability**: Transitous is community-run on volunteer infrastructure → Mitigation: existing city-specific endpoints and Overpass remain as fallbacks. If Transitous is down, the map still shows transit for configured cities via existing pipelines.
- **Tile data freshness**: Transitous refreshes feeds daily → Mitigation: acceptable for a map layer. Real-time delay data still comes from MOTIS API.
- **Tile URL stability**: The tile endpoint path may change with MOTIS versions → Mitigation: configurable `EXPO_PUBLIC_TRANSITOUS_BASE_URL` allows overriding without code changes.
- **Styled tiles may not match Polaris design**: Transitous tiles use their own color scheme → Mitigation: MapLibreGL style expressions can override tile properties. If needed, apply client-side color mapping.
- **API rate limits**: Transitous asks heavy users to self-host → Mitigation: routing and departures are infrequent per-user operations. Map tiles are standard per-zoom-level requests. Contact Transitous maintainers per their usage policy.
- **Dependency on `@motis-project/motis-client`**: External npm package with its own release cycle → Mitigation: pin to a specific version. The MOTIS 2 API is versioned and stable.

## Open Questions

- Does the Transitous tile endpoint include all route properties we need (route name, color, mode) in vector tile feature properties? Need to inspect a tile response.
- Should we add a user-facing setting to toggle Transitous vs. individual endpoints? Useful for debugging and regions where Transitous data is incomplete.
- Should we keep the GTFS-based endpoints (cta-gtfs-v1, septa-gtfs-v1, etc.) now that Transitous covers those cities? They remain useful as no-API-key fallbacks with local data, but may be redundant once Transitous proves reliable.
