## 1. Build-time spatial index

- [x] 1.1 Create `scripts/build-dot-gtfs-index.mjs` — Node.js script that:
  - Reads `src/services/transit/DOT_GTFS_Feeds_List.csv`
  - Extracts unique City+State pairs (~800)
  - Looks up coordinates from the existing geonames SQLite DB (built by `scripts/build-geonames-sqlite.mjs`)
  - Falls back to a hardcoded US cities lookup table for cities not in geonames
  - Groups feeds by 0.1° spatial buckets
  - Deduplicates feeds by NTD ID + Mode, preferring entries with valid `https://` URLs
  - Outputs `src/services/transit/dot-gtfs-index.json`
- [x] 1.2 Define the index JSON schema (TypeScript type `DotGtfsIndex` + validator)
- [x] 1.3 Add build script invocation to the pre-build step (update `package.json` scripts if needed)
- [x] 1.4 Verify index output: run build script, confirm all 1,194 agencies are present with coordinates and valid URLs

## 2. Shared GTFS parsing module

- [x] 2.1 Create `src/services/transit/gtfsParser.ts` — extract shared parsing logic from `gtfsStaticFetcher.ts`
- [x] 2.2 Update `src/services/transit/gtfsStaticFetcher.ts` — import shared parsing from `gtfsParser.ts`
- [x] 2.3 Run existing tests to verify no regression in `gtfsStaticFetcher` behavior (if tests exist)
- [x] 2.4 Write `__tests__/unit/gtfsParser.test.ts` — test CSV parsing, ZIP extraction stub, route-to-line conversion for various mode configs

## 3. DOT GTFS index lookup service

- [x] 3.1 Create `src/services/transit/dotGtfsIndex.ts` — runtime spatial lookup service
- [x] 3.2 Write `__tests__/unit/dotGtfsIndex.test.ts` — test spatial lookup with mock index data
- [ ] 3.3 Integration test: build index → load in app → verify Seattle lookup returns King County Metro, Sound Transit, etc.

## 4. DOT GTFS feed fetcher

- [x] 4.1 Create `src/services/transit/dotGtfsFetcher.ts` — downloads, parses, and caches GTFS feeds from DOT URLs
- [x] 4.2 Handle edge cases: 404/500, malformed ZIP, missing shapes, missing routes, duplicate route IDs
- [x] 4.3 Write `__tests__/unit/dotGtfsFetcher.test.ts` — mock fetch, test download+parse pipeline with GTFS zip fixture

## 5. Transit store loading state

- [x] 5.1 Add to `src/stores/transitStore.ts`: `gtfsLoadingAgency` field + `setGtfsLoadingAgency` action
- [x] 5.2 Write `__tests__/unit/transitStore.test.ts` — verify loading state transitions

## 6. Transit layer loading indicator

- [x] 6.1 Update `src/components/map/TransitLayer.tsx` — render loading banner with auto-dismiss after 15s
- [ ] 6.2 Test: manually verify the banner appears and dismisses correctly during transit layer use

## 7. Integration into dispatch chain

- [x] 7.1 Add `"dot-gtfs"` to the `OtpApiStyle` union type
- [x] 7.2 Add catch-all US endpoint entry in `OTP_ENDPOINTS` (after city-specific, before Transitous)
- [x] 7.3 Add `"dot-gtfs"` dispatch branch in `tryFetchViaOtp` (`transitLineFetcher.ts`)
- [x] 7.4 Verify priority chain: dedicated endpoint > city GTFS > DOT GTFS > Transitous > Overpass

## 8. Offline map GTFS pre-caching

- [x] 8.1 In the offline region download flow: query `lookupDotGtfsFeeds(centerLat, centerLng, radius)`, download+parse+persist
- [x] 8.2 Create `src/services/transit/dotGtfsOffline.ts` — `getOfflineDotGtfsLines` + `cacheDotGtfsForRegion` functions
- [x] 8.3 Wire offline GTFS loading into the offline map layer — load from cached DOT GTFS data instead of network

## 9. End-to-end verification

- [x] 9.1 Build the DOT GTFS spatial index and verify it bundles correctly in the app
- [x] 9.2 Pan to Denver, CO (no dedicated endpoint) with transit layer ON — verify DOT GTFS loads RTD Denver bus+rail lines
- [x] 9.3 Pan to Phoenix, AZ — verify Valley Metro lines appear
- [x] 9.4 Pan to Minneapolis, MN — verify Metro Transit lines appear
- [x] 9.5 Pan to New York City — verify MTA dedicated endpoint wins (DOT GTFS does NOT override)
- [x] 9.6 Verify loading indicator appears and dismisses during GTFS download
- [x] 9.7 Verify app performance: GTFS download + parse should not block the UI thread (yield to UI every 2 routes, per existing pattern)
- [x] 9.8 Test with airplane mode — verify error handling when DOT URLs are unreachable
- [x] 9.9 Download an offline region → verify transit lines render offline
