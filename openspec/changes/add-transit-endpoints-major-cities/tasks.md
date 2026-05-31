## 1. Finalize Overpass Reliability (safety net)

- [x] 1.1 Verify `overpassClient.ts` uses POST method (already changed)
- [x] 1.2 Verify Overpass `[timeout:60]` in both `fetchTile` and `prewarmTransitCache` (already changed)
- [x] 1.3 Verify `OVERPASS_TIMEOUT_MS = 75_000` and client timeouts (already changed)
- [x] 1.4 Verify `fetchTileWithRetry` wrapper with 3-retry exponential backoff (already added)
- [x] 1.5 Verify error logging in `useTransitStops.ts` catch block (already changed)
- [x] 1.6 Verify `__clearTransitLineCache` export exists for test isolation (already added)
- [x] 1.7 Run `transitLineFetcher.test.ts` and `overpassClient.test.ts` — all must pass

## 2. GTFS Static Fetcher (shared infrastructure)

- [x] 2.1 Create `src/services/transit/gtfsStaticFetcher.ts` with `fetchGtfsStaticLines(config)` function
- [x] 2.2 Implement GTFS zip download with `fetch()` and `timeoutMs` config
- [x] 2.3 Implement streaming zip entry parser (use `JSZip` or similar, already a dependency?)
- [x] 2.4 Parse `routes.txt` — filter by `config.routeTypeFilter`, build route name/ref/color map
- [x] 2.5 Parse `trips.txt` — map route_id to shape_id for route→shape association
- [x] 2.6 Parse `shapes.txt` — decode shape points into `[lng, lat][]` polylines
- [x] 2.7 Parse `stops.txt` and `stop_times.txt` — collect route stops with name+coordinates
- [x] 2.8 Map GTFS `route_type` to `TransitMode` using `config.modeMap`
- [x] 2.9 Assemble `TransitRouteLine[]` with geometry, stops, colors, mode
- [x] 2.10 Add permanent in-memory cache per config (deduplicate by `config.label`)
- [x] 2.11 Add error handling: return `[]` on fetch/parse failure, log warnings

## 3. WMATA REST Fetcher (Washington DC)

- [x] 3.1 Create `src/services/transit/wmataFetcher.ts`
- [x] 3.2 Implement `fetchWmataLines()` — GET `https://api.wmata.com/Rail.svc/json/jLines` + `jStations`
- [x] 3.3 Parse line data: `DisplayName` → name, `LineCode` → ref, built-in colors for each line
- [x] 3.4 Build station geometry from `jStations` Lat/Lon, associate with lines via StationCodes
- [x] 3.5 Since WMATA API does not return polylines, construct line geometry from station-to-station straight-line segments ordered by sequence
- [x] 3.6 Add permanent in-memory cache using singleton pattern (same as `mbtaFetcher.ts`)
- [x] 3.7 Add `EXPO_PUBLIC_WMATA_API_KEY` support for authenticated requests
- [x] 3.8 Add `clearWmataCache()` export for testing

- [x] 4.1 Create `src/services/transit/bartFetcher.ts`
- [x] 4.2 Implement `fetchBartLines()` — GET `https://api.bart.gov/api/route.aspx?cmd=routes` + `routeinfo`
- [x] 4.3 Parse route data: route name, number, color, hexcolor
- [x] 4.4 Parse route info: station list with coordinates and order
- [x] 4.5 Build line geometry from station-to-station straight-line segments ordered by sequence
- [x] 4.6 Add permanent in-memory cache (singleton pattern)
- [x] 4.7 No API key required for BART (public API)
- [x] 4.8 Add `clearBartCache()` export for testing

- [x] 5.1 Create `src/services/transit/tflFetcher.ts`
- [x] 5.2 Implement `fetchTflLines()` — GET modes → GET Line/Mode/{mode} → GET Line/{id}/Route/Sequence/outbound
- [x] 5.3 Support modes: tube, dlr, overground, elizabeth-line, tram, tflrail
- [x] 5.4 Parse polyline from `lineStrings` in Route/Sequence response
- [x] 5.5 Parse stops from `GET /Line/{id}/StopPoints`
- [x] 5.6 Map TfL mode names to `TransitMode` (tube→SUBWAY, dlr/tram→TRAM, overground/elizabeth-line→RAIL)
- [x] 5.7 Add permanent in-memory cache (singleton pattern)
- [x] 5.8 No API key required for TfL Unified API (public)
- [x] 5.9 Add `clearTflCache()` export for testing

- [x] 6.1 Add WMATA endpoint entry to `OTP_ENDPOINTS` with `apiStyle: "wmata-v1"`, bbox for DC metro area
- [x] 6.2 Add BART endpoint entry to `OTP_ENDPOINTS` with `apiStyle: "bart-v1"`, bbox for SF Bay Area
- [x] 6.3 Add CTA endpoint entry to `OTP_ENDPOINTS` with `apiStyle: "cta-gtfs-v1"`, bbox for greater Chicago
- [x] 6.4 Add SEPTA endpoint entry with `apiStyle: "septa-gtfs-v1"`, bbox for Philadelphia
- [x] 6.5 Add LA Metro endpoint entry with `apiStyle: "lametro-gtfs-v1"`, bbox for Los Angeles County
- [x] 6.6 Add MARTA endpoint entry with `apiStyle: "marta-gtfs-v1"`, bbox for Atlanta
- [x] 6.7 Add Miami Metrorail endpoint entry with `apiStyle: "miami-gtfs-v1"`, bbox for Miami
- [x] 6.8 Add Baltimore endpoint entry with `apiStyle: "baltimore-gtfs-v1"`, bbox for Baltimore

- [x] 7.1 Add TfL endpoint entry to `OTP_ENDPOINTS` with `apiStyle: "tfl-v1"`, bbox for Greater London
- [x] 7.2 Add Paris IDFM endpoint entry with `apiStyle: "idfm-gtfs-v1"`, bbox for Ile-de-France
- [x] 7.3 Add Berlin VBB endpoint entry with `apiStyle: "vbb-gtfs-v1"`, bbox for Berlin
- [x] 7.4 Add Madrid CRTM endpoint entry with `apiStyle: "madrid-gtfs-v1"`, bbox for Madrid metro area

- [x] 8.1 Add WMATA `apiStyle` branch in `tryFetchViaOtp` — dispatch to `fetchWmataLines()`
- [x] 8.2 Add BART `apiStyle` branch in `tryFetchViaOtp` — dispatch to `fetchBartLines()`
- [x] 8.3 Add TfL `apiStyle` branch in `tryFetchViaOtp` — dispatch to `fetchTflLines()`
- [x] 8.4 Add GTFS-based `apiStyle` branches in `tryFetchViaOtp` — dispatch to `fetchGtfsStaticLines(config)` with the correct config for each city
- [x] 8.5 Add `transmodel-v3` branch in `tryFetchViaOtp` — dispatch to `fetchEnturLines()` (currently falls through to Overpass for Norway)
- [x] 8.6 Add "Unknown apiStyle" warning when falling through to Overpass for unrecognized styles

## 9. Tests

- [x] 9.1 Write `__tests__/unit/gtfsStaticFetcher.test.ts` — mock zip download, verify shape parsing and mode mapping
- [x] 9.2 Write `__tests__/unit/wmataFetcher.test.ts` — mock WMATA API, verify line+station parsing
- [x] 9.3 Write `__tests__/unit/bartFetcher.test.ts` — mock BART API
- [x] 9.4 Write `__tests__/unit/tflFetcher.test.ts` — mock TfL API
- [x] 9.5 Update `otpEndpointRegistry.test.ts` (if exists) or add it — verify all new endpoints match correct cities
- [x] 9.6 Update `transitLineFetcher.test.ts` — add tests for `tryFetchViaOtp` dispatching new apiStyles
- [x] 9.7 Update `transitRoutingService.test.ts` — verify `OTP_ENDPOINTS.length` reflects new entries
- [x] 9.8 Run full test suite — all tests pass, no regressions

- [ ] 10.1 Manually test transit layer over Washington DC — WMATA lines appear within 5 seconds
- [ ] 10.2 Manually test transit layer over Chicago — CTA "L" lines appear
- [ ] 10.3 Manually test transit layer over San Francisco — BART lines appear
- [ ] 10.4 Manually test transit layer over Philadelphia — SEPTA Metro lines appear
- [ ] 10.5 Manually test transit layer over Los Angeles — LA Metro Rail lines appear
- [ ] 10.6 Manually test transit layer over London — TfL Tube/Overground/DLR lines appear
- [ ] 10.7 Manually test transit layer over Paris — Metro lines appear
- [ ] 10.8 Verify toggle on/off restores lines from cache instantly (no re-fetch)
- [ ] 10.9 Verify Overpass fallback still works for cities without any endpoint (e.g., Denver, Seattle)
