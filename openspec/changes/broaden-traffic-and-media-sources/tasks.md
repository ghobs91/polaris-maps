## 1. Policy and configuration groundwork

- [x] 1.1 Remove HERE constants (`HERE_FLOW_BASE_URL`, `hereApiKey`) and the retired paid Apple MapKit constants (`appleMapkitToken`, `mapkitPlaceDetailUrl`, `mapkitJsEmbedToken`) from `src/constants/config.ts`; keep the TomTom constants (`TOMTOM_FLOW_BASE_URL`, `TOMTOM_FLOW_TILES_BASE_URL`, `tomtomApiKey`) documented as the bounded cold-start exception
- [x] 1.2 Remove `EXPO_PUBLIC_HERE_API_KEY`, `EXPO_PUBLIC_APPLE_MAPKIT_TOKEN`, `EXPO_PUBLIC_MAPKIT_PLACE_DETAIL_URL`, `EXPO_PUBLIC_APPLE_MAPKITJS_EMBED_TOKEN`, and the `APPLE_*` token-generation helpers from `.env.example`; keep `EXPO_PUBLIC_TOMTOM_API_KEY` documented as optional cold-start
- [x] 1.3 Update `src/types/env.d.ts` to drop the HERE and retired MapKit web-service variables and add any new free/open source variables
- [x] 1.4 Add a repo-wide guard (lint rule or test) asserting no retired paid provider name or endpoint (HERE, MapKit JS embed, Apple Maps Server API) appears in runtime source or config; TomTom is permitted only through the config-gated cold-start bridge
- [x] 1.5 Verify `pnpm typecheck` passes with no HERE or retired MapKit-embed constants referenced anywhere

## 2. Traffic sources: HERE removal, open-feed tier, cold-start tier

- [x] 2.1 Delete `src/services/traffic/hereFetcher.ts`
- [x] 2.2 Keep the TomTom seeding in `src/services/traffic/trafficTileService.ts` as the lowest-priority tier; ensure tile resolution is local cache → peers → open feed → TomTom cold-start (if configured) → no-data
- [x] 2.3 In `src/services/traffic/trafficCascade.ts`, keep the TomTom seed tier but demote it below a new open-feed tier, still gated by the `seedFromTomTom` callback only when the cold-start bridge is configured
- [x] 2.4 In `src/services/traffic/trafficFlowService.ts`, keep `fetchTomTomTraffic`, `sampleRoutePoints`, and `sampleRouteTileColors` as the cold-start path and wire the new open-feed tier above them
- [x] 2.5 Keep the TomTom route-ETA fallback in `src/hooks/useTrafficEta.ts` as the lowest-priority tier, retaining the `MIN_MATCH_RATIO_FOR_LOCAL` commercial branch as cold-start-only
- [x] 2.6 Keep the TomTom raster URL fallback and `tomtom-traffic` source/layer IDs in `src/components/map/TrafficOverlay.tsx` as the lowest-priority tier; the local/peer tile server remains primary
- [x] 2.7 Remove the HERE traffic entries from `src/services/carplay/carPlayManager.ts` and its README if they still advertise HERE
- [x] 2.8 Verify no HERE request appears in device logs, and that TomTom is queried only when its key is configured and no higher tier resolved

## 3. Open traffic feeds and resolution precedence

- [x] 3.1 Define a normalized open-feed adapter interface (bounding-box input, `NormalizedTrafficSegment[]` output) under `src/services/traffic/`
- [x] 3.2 Implement the first adapter(s) for free open feeds (for example NL NDW and a US DOT 511 / DATEX II source), with allowed free-keyed configuration only
- [x] 3.3 Enforce precedence in the cascade: local fresh → local historical → P2P → open feed → TomTom cold-start (if configured) → no-data, consulting a later tier only for unresolved cells
- [x] 3.4 Ensure open-feed and cold-start failures are non-fatal and contribute no data without surfacing raw errors
- [x] 3.5 Add unit tests for adapter normalization and for precedence short-circuiting at each tier boundary

## 4. Traffic coverage UI

- [x] 4.1 Extend the traffic store/model with an explicit coverage status (P2P, open-feed, cold-start, stale, no-data) derived from the resolve source
- [x] 4.2 Surface the coverage status in the traffic overlay/legend with iconography and short labels
- [x] 4.3 Render an explicit no-data state when no tier resolves the viewport, with no raw error text
- [x] 4.4 Ensure degraded (stale/no-data) and cold-start states are visually distinguishable from full P2P coverage per the UX consistency principle
- [ ] 4.5 Add integration/component tests covering P2P, open-feed, cold-start, and no-data states

## 5. Free satellite imagery

- [x] 5.1 Replace the Esri World Imagery source in `src/constants/satelliteStyle.ts` with Sentinel-2 cloudless (global) and USGS NAIP (US) raster sources
- [x] 5.2 Set the required provider attribution on each imagery source and surface it via the map attribution
- [x] 5.3 Verify the style has no `server.arcgisonline.com` source or Esri attribution
- [ ] 5.4 Ensure imagery unavailability degrades to a visible limited-coverage state rather than an empty or errored map
- [x] 5.5 Update `src/services/map/offlineStyle.ts` handling if it assumes the removed Esri raster source
- [x] 5.6 Update `__tests__/unit/offlineStyle.test.ts` (or equivalent) for the new imagery sources

## 6. Paid MapKit web services and retained place media

- [x] 6.1 Delete `src/services/poi/placeDetailEmbed.ts`, `src/components/map/PlaceDetailEmbed.tsx`, `netlify-deploy/place-detail.html`, `scripts/generate-mapkit-token.mjs`, and `scripts/test-mapkit.js`
- [x] 6.2 Delete the paid Apple Maps Server API client `src/services/poi/mapkitFetcher.ts` and its callers, and remove the MapKit embed/server token plumbing
- [x] 6.3 Keep `src/services/poi/websitePhotosService.ts` and `src/components/map/WebsitePhotosCarousel.tsx` as the primary place-media source (on-device OpenGraph/`<img>` scraping); do not replace them with Wikimedia Commons or another third-party provider
- [ ] 6.4 Ensure the place card shows an explicit empty media state when the website scrape returns no photos
- [x] 6.5 Keep the native MapKit enrichment (`src/native/mapkit/`, `src/services/poi/poiEnricher.ts`) optional on iOS with graceful degradation
- [x] 6.6 Update `src/components/map/POIInfoCard.tsx` to remove the paid MapKit JS embed mount while retaining the `WebsitePhotosCarousel`
- [x] 6.7 Confirm the place card shows scraped media or an empty state and performs no paid web request; keep `react-native-webview` because the website-photo carousel still depends on it

## 7. Documentation and environment

- [x] 7.1 Update the README architecture diagram and external-APIs block to list P2P probes, open traffic feeds, the optional TomTom cold-start bridge, Sentinel-2/NAIP, on-device website photos, and native MapKit, with no HERE/Esri/MapKit JS entries
- [x] 7.2 Update the README tech-stack table (`Traffic` row) and the environment-variables example to match the new `.env.example` (TomTom optional/ cold-start)
- [x] 7.3 Update `src/services/traffic/README.md` to describe P2P-primary sources, the open-feed tier, the optional TomTom cold-start tier with its exit criterion, precedence, and coverage states; remove HERE claims
- [x] 7.4 Update `src/services/poi/README.md` to document on-device website photo scraping as primary and native MapKit-only enrichment; remove MapKit JS / Apple Maps Server API references
- [x] 7.5 Update `src/components/map/README.md` and `src/services/carplay/README.md` where they reference HERE or paid imagery sources
- [x] 7.6 Update `AGENTS.md` environment/source notes if they enumerate retired paid variables
- [x] 7.7 Add a licenses/attribution surface (or About entry) documenting imagery attribution obligations

## 8. Tests, deletion, and verification

- [x] 8.1 Delete `__tests__/unit/hereFetcher.test.ts` and `__tests__/unit/placeDetailEmbed.test.ts`
- [x] 8.2 Delete or rewrite `__tests__/integration/placeDetailEmbed.test.tsx` for the removal, and update `__tests__/integration/trafficOverlay.test.tsx` to cover the retained TomTom cold-start path and the new tiers
- [x] 8.3 Update `__tests__/unit/trafficCascade.test.ts` for the open-feed and cold-start tiers and precedence
- [x] 8.4 Update `__tests__/unit/routeTrafficService.test.ts`, `__tests__/unit/etaCalculator.test.ts`, and `__tests__/benchmark/etaCalculator.bench.ts` where they assume commercial traffic segments
- [x] 8.5 Run `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` and resolve all failures
- [x] 8.6 Run the relevant Jest unit/integration suites and report exact results
- [ ] 8.7 Manual iOS verification: launch with no TomTom, HERE, or MapKit JS keys, and confirm the map, traffic (P2P + open feed + coverage state), satellite imagery with attribution, and the website-photos place card all function
- [x] 8.8 Search the repository for `here`, `arcgisonline`, and `mapkitjs` and confirm only planning/archive artifacts remain (TomTom and TripAdvisor are intentionally retained)
