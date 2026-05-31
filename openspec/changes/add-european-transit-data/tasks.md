## 1. Extend OtpApiStyle union type

- [x] 1.1 Add 10 new apiStyle literal values (`de-gtfs-v1`, `dk-gtfs-v1`, `fi-gtfs-v1`, `ee-gtfs-v1`, `ie-gtfs-v1`, `lu-gtfs-v1`, `nl-gtfs-v1`, `no-gtfs-v1`, `se-gtfs-v1`, `ch-gtfs-v1`) to `OtpApiStyle` in `src/services/transit/otpEndpointRegistry.ts`
- [x] 1.2 Verify TypeScript compiles without errors for the extended union type

## 2. Register country endpoints in OTP_ENDPOINTS

- [x] 2.1 Add 10 country `OtpEndpoint` entries to `OTP_ENDPOINTS` array in `src/services/transit/otpEndpointRegistry.ts`, placed after CRTM Madrid and before Entur Norway, with national bboxes per design.md Decision 4 and URLs from `https://data.public-transport.earth/gtfs/{code}`
- [x] 2.2 Verify `findEndpointForCoords` returns the correct endpoint for each country capital (e.g., Copenhagen → `dk-gtfs-v1`, Berlin → `vbb-gtfs-v1` NOT `de-gtfs-v1`, Helsinki → `fi-gtfs-v1`)
- [x] 2.3 Verify `findEndpointForCoords` returns `null` for coordinates outside all country bboxes (e.g., Beijing, Sydney)

## 3. Add GTFS fetcher configs

- [x] 3.1 Add 10 country entries to `GTFS_CONFIGS` in `src/services/transit/transitLineFetcher.ts`, each with `filterByRouteType: false`, appropriate `timeoutMs` per design.md Decision 6, and a descriptive `label`
- [x] 3.2 Verify `GTFS_CONFIGS['dk-gtfs-v1']` returns a config with `filterByRouteType: false` and `timeoutMs: 60000`

## 4. Verify dispatch chain integration

- [x] 4.1 Confirm the existing `gtfsConfig` branch in `tryFetchViaOtp` in `src/services/transit/transitLineFetcher.ts` handles the new apiStyle values without code changes (walk the code path: `findEndpointForCoords` → `GTFS_CONFIGS[ep.apiStyle]` → `fetchGtfsStaticLines`)
- [x] 4.2 Verify that a city-specific endpoint (e.g., VBB Berlin) still wins over its country endpoint (Germany) when the viewport center is in Berlin — confirm via ordering in `OTP_ENDPOINTS`

## 5. End-to-end verification

- [ ] 5.1 Pan to Copenhagen (55.67, 12.57) with transit layer ON — verify Denmark GTFS loads and shows bus, train, and metro lines with stops
- [ ] 5.2 Pan to Helsinki (60.17, 24.94) with transit layer ON — verify Finland GTFS loads
- [ ] 5.3 Pan to Zurich (47.37, 8.54) with transit layer ON — verify Switzerland GTFS loads
- [ ] 5.4 Pan to Amsterdam (52.37, 4.90) with transit layer ON — verify Netherlands GTFS loads
- [ ] 5.5 Pan to Dublin (53.35, -6.26) with transit layer ON — verify Ireland GTFS loads
- [ ] 5.6 Pan to Stockholm (59.33, 18.07) with transit layer ON — verify Sweden GTFS loads
- [ ] 5.7 Pan to Oslo (59.91, 10.75) with transit layer ON — verify Norway GTFS loads
- [ ] 5.8 Pan to Luxembourg City (49.61, 6.13) with transit layer ON — verify Luxembourg GTFS loads
- [ ] 5.9 Pan to Tallinn (59.44, 24.75) with transit layer ON — verify Estonia GTFS loads
- [ ] 5.10 Pan to Berlin (52.52, 13.40) with transit layer ON — verify VBB Berlin endpoint (not Germany GTFS) loads first
- [ ] 5.11 Pan to Hamburg (53.55, 10.0) with transit layer ON — verify Germany GTFS loads (VBB does not cover Hamburg)
- [ ] 5.12 Verify persistent caching: toggle transit layer OFF, then ON — lines should reload from MMKV cache without network fetch (check console logs for `[gtfs-static] Denmark GTFS loaded from persistent cache`)
- [ ] 5.13 Test with airplane mode — verify graceful fallback to cached data or Overpass when country feeds are unreachable
- [ ] 5.14 Verify app performance: GTFS download + parse should not freeze the UI (existing `yieldToUI` pattern handles this)
