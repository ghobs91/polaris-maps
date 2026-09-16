## Why

Polaris Maps is a peer-to-peer DePIN mapping app, but its default runtime path still leans on commercial services and non-open data: TomTom traffic flow, raster tiles, and route ETA are wired into the traffic overlay and tile seeding; the Apple MapKit JS PlaceDetail embed and the Apple Maps Server API are paid iOS web services; and the satellite layer renders non-open-licensed Esri World Imagery. HERE traffic exists as unwired dead code that the README still claims is merged.

The owner constraint is that the app must stay decentralized and P2P-first, with free/open sources as the target end state. TomTom is therefore no longer slated for removal: it is retained as a documented, time-boxed cold-start bridge so traffic works before the P2P network is dense. Traffic becomes P2P + free open feeds (US DOT 511 / DATEX II / NL NDW) first, with TomTom a lower-priority, optional, config-gated fallback that degrades gracefully and is never required. On-device website (OpenGraph/`<img>`) place-photo scraping is retained as the primary place-media source; Wikimedia Commons is not an acceptable replacement for place photos.

## What Changes

1. Establish a **data-source policy** with a bounded traffic cold-start exception: core functionality works without paid APIs; no new paid providers; the only permitted commercial path is an optional, config-gated, time-boxed traffic flow/raster bootstrap that must degrade gracefully and must never be required by any other feature.
2. Make **P2P probes and peer-shared traffic tiles the primary traffic source** and add **optional free open feed adapters** (government 511 / DATEX II / NL NDW, free-keyed allowed), with an explicit precedence: local cache (fresh → historical) → P2P peers → open feed → optional TomTom cold-start (if configured) → no-data.
3. Remove **HERE traffic dead code** (`hereFetcher.ts`) and its key/config/endpoint constants.
4. Remove the paid **MapKit JS PlaceDetail embed** and **Apple Maps Server API** client, the hosted Netlify place-detail page, the embed token plumbing, and the token-generation scripts.
5. Replace the **Esri World Imagery satellite layer** with free/open imagery (Sentinel-2 cloudless / USGS NAIP) and required attribution, keeping OpenFreeMap vector labels on top.
6. **Retain on-device website photo scraping** (`websitePhotosService.ts` + `WebsitePhotosCarousel.tsx`) as the primary place-media source with an explicit empty state, and keep the **on-device native Apple MapKit module** (free on iOS) as optional POI enrichment with graceful degradation. Free street imagery (Panoramax) may be added later but is not required.
7. Update `.env.example`, `src/constants/config.ts`, `src/types/env.d.ts`, the README architecture diagram/tech-stack table, the affected service READMEs (traffic, POI, map components), and tests. Surface a **traffic coverage state** in the UI (P2P, open feed, cold-start, stale, no-data).
8. Android remains out of scope; iOS ships.

## Capabilities

### New Capabilities

- `data-source-policy`: Core functionality without paid APIs; a bounded, optional, time-boxed traffic cold-start exception; no new paid providers; allowed source classes; graceful user-visible degradation; retired paid web services deleted rather than disabled.
- `open-traffic-sources`: P2P probes/tiles as the primary traffic source, optional free open data feeds for bootstrapping, an optional lower-priority TomTom cold-start fallback, a defined resolution precedence, explicit UI coverage state, and removal of HERE traffic code.
- `imagery-and-place-media`: Satellite/aerial imagery from free/open providers with required attribution (replacing Esri); place photos from the retained on-device website scraper as primary with an explicit empty state; optional later open street imagery; paid MapKit web services removed; optional native MapKit enrichment on iOS with graceful degradation.

### Modified Capabilities

None — `openspec/specs/` is empty, so every capability in this change is introduced as a new spec.

## Impact

- **Traffic**: `src/services/traffic/{hereFetcher,trafficTileService,trafficCascade,trafficFlowService}.ts` (remove HERE; add feed adapters and the cold-start tier), `src/hooks/useTrafficEta.ts` (keep the TomTom fallback as the lower-priority tier), `src/components/map/TrafficOverlay.tsx` (keep the cold-start raster path as the lowest-priority tier), `src/models/traffic*.ts`, `src/stores/trafficStore.ts`
- **POI / place media**: `src/services/poi/{placeDetailEmbed,mapkitFetcher}.ts` (remove paid web services), `src/components/map/PlaceDetailEmbed.tsx` (remove), `src/components/map/POIInfoCard.tsx` (drop the paid embed mount; keep the website-photos carousel), `src/services/poi/websitePhotosService.ts` + `src/components/map/WebsitePhotosCarousel.tsx` (retained), `src/services/poi/poiEnricher.ts` + `src/native/mapkit/` (keep native module)
- **Imagery**: `src/constants/satelliteStyle.ts`, `src/components/map/mapStyleResolver.ts`
- **Config**: `src/constants/config.ts`, `src/types/env.d.ts`, `.env.example`, `README.md`, `src/services/traffic/README.md`, `src/services/poi/README.md`, `src/components/map/README.md`
- **Scripts/hosting**: `scripts/generate-mapkit-token.mjs`, `scripts/test-mapkit.js`, `netlify-deploy/place-detail.html`
- **Tests**: update traffic cascade/overlay tests for the feed + cold-start tiers; delete `hereFetcher` and `placeDetailEmbed` tests
- **Dependencies**: no new paid dependencies; `react-native-webview` is retained (still used by the website photo scrape). Android out of scope.
- **Out of scope**: TripAdvisor scraping removal and Wikimedia Commons place-photo replacement are NOT part of this change.
