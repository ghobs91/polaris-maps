## 1. Setup and Dependencies

- [x] 1.1 Add `@motis-project/motis-client` to `package.json` dependencies — SKIPPED: using raw fetch with typed request/response, no external dependency needed
- [x] 1.2 Add `EXPO_PUBLIC_TRANSITOUS_BASE_URL` to `.env.example` (default: `https://api.transitous.org/api`)
- [x] 1.3 Create `src/services/transit/transitousClient.ts` — thin wrapper around MOTIS client exporting typed helper functions
- [x] 2.1 Add `"transitous-v1"` to the `OtpApiStyle` union type
- [x] 2.2 Add Transitous endpoint entry to `OTP_ENDPOINTS` with `label: "Transitous (global)"`, `bbox: [-90, -180, 90, 180]`, `url: https://api.transitous.org/api`, `apiStyle: "transitous-v1"` — placed LAST in the array
- [x] 2.3 Add `"transitous-v1"` branch in `tryFetchViaOtp` that returns `null` (lines handled by vector tiles)
- [x] 2.4 Verify `findEndpointForCoords` returns Transitous as fallback for uncovered cities and city-specific endpoints take priority for configured cities
- [x] 3.1 Create `src/components/map/TransitousTileLayer.tsx` — component that renders a MapLibreGL VectorSource + LineLayer + SymbolLayer
- [x] 3.2 Configure tile URL: `{baseUrl.replace('/api', '')}/map/mapbox-gl-rt/{z}/{x}/{y}.mvt`
- [x] 3.3 Add style expressions for transit route rendering (line-width based on zoom, line-color from tile feature properties)
- [x] 3.4 Wire TransitousTileLayer into `TransitLayer.tsx` alongside existing RouteLinesLayer
- [x] 3.5 Respect `transitLayerVisible` store flag for tile layer visibility
- [x] 3.6 Add error boundary — on tile endpoint failure, log warning and hide tile layer, leaving existing JS lines intact
- [ ] 3.7 Inspect Transitous tile feature properties and add stop-label symbol layer if stop data is available in tiles
- [x] 4.1 Create `src/services/transit/transitousRouting.ts` — module with `planTransitousTrip(origin, dest, time, count)` function
- [x] 4.2 Implement POST `/trip` call via MOTIS client with origin/destination, departure time, result count
- [x] 4.3 Map MOTIS trip response to `OtpItinerary[]` — mode mapping, leg geometry decoding, route info extraction
- [x] 4.4 Add MOTIS leg mode → Polaris `LegMode` mapping (walk, transit_bus, transit_train, transit_tram, transit_subway, bicycle, car)
- [x] 4.5 Add Transitous routing dispatch in `transitRoutingService.ts` `planTransitTrip` — call Transitous first, fall back to OTP on failure
- [ ] 4.6 Decode MOTIS polyline geometry strings (if MOTIS uses different encoding than OTP)
- [x] 5.1 Create `src/services/transit/transitousDepartures.ts` — module with `fetchTransitousDepartures(stopId, lat, lon)` function
- [x] 5.2 Implement POST `/stop_event` call with stop coordinates, time window, and result count
- [x] 5.3 Map MOTIS stop_event response to existing `StopDepartureInfo` model
- [x] 5.4 Preserve real-time delay data: `isRealtime`, `realtimeTime`, `minutesAway` with delay adjustment
- [ ] 5.5 Add Transitous departure dispatch in `transitDepartureFetcher.ts` — call Transitous after city-specific APIs fail

## 6. Tests

- [ ] 6.1 Write `__tests__/unit/transitousClient.test.ts` — mock MOTIS client, verify endpoint URL construction
- [ ] 6.2 Write `__tests__/unit/transitousRouting.test.ts` — mock /trip response, verify OtpItinerary mapping
- [ ] 6.3 Write `__tests__/unit/transitousDepartures.test.ts` — mock /stop_event response, verify StopDepartureInfo mapping
- [x] 6.4 Update `__tests__/unit/otpEndpointRegistry.test.ts` (or verify existing tests) — confirm Transitous is returned for uncovered cities
- [x] 6.5 Update `__tests__/unit/transitLineFetcher.test.ts` — verify `transitous-v1` returns `null` (doesn't trigger Overpass)
- [x] 6.6 Update `__tests__/unit/transitRoutingService.test.ts` — verify Transitous fallback chain works

## 7. Integration Verification

- [ ] 7.1 Manually test transit layer over Denver, Seattle, or another city without a city-specific endpoint — Transitous tiles render transit lines
- [ ] 7.2 Manually test transit layer over an uncovered European city (e.g., Vienna, Amsterdam) — Transitous tiles render transit lines
- [ ] 7.3 Manually test routing between two points in London — MOTIS returns valid itineraries
- [ ] 7.4 Manually test departures at a station — Transitous returns departure board with real-time data
- [ ] 7.5 Manually test fallback: disconnect from network, toggle transit layer — tile layer shows error state gracefully
- [ ] 7.6 Manually test that Boston MBTA departures still work (city-specific takes priority over Transitous)
- [ ] 7.7 Verify Transitous tile endpoint respects the usage policy (proper User-Agent header)
