## 1. Registry metadata

- [x] 1.1 Add `resolutionM`, `acquiredAt`, and optional `minzoom` to `RegionalOrthophotoSource` and populate all 28 regional entries
- [x] 1.2 Add the LINZ (New Zealand) source, env-gated on `EXPO_PUBLIC_LINZ_API_KEY`
- [x] 1.3 Add `GLOBAL_IMAGERY_SOURCES` (Sentinel-2/EOx, USGS NAIP, GIBS Landsat/MODIS/VIIRS, OAM STAC) with live-verified templates
- [x] 1.4 Export `IMAGERY_SOURCES` = global + regional

## 2. Routing engine

- [x] 2.1 `boundsIntersect` / `sourceCoversBounds` / `sourceSupportsZoom` helpers
- [x] 2.2 `rankImagerySources` — resolution ascending, recency within ±10%, deterministic id tie-break, near-equal grouping
- [x] 2.3 `selectBestTileSource` returning `{ selected, ranked }`
- [x] 2.4 `createTileMetadataCache` — TTL + LRU
- [x] 2.5 Convenience `selectBestImagerySource(bbox, zoom)` defaulting to `IMAGERY_SOURCES`

## 3. Documentation

- [x] 3.1 `src/services/map/README.md` with the routing contract and the native no-custom-protocol note
- [x] 3.2 Module header documents why runtime per-tile switching is not wired

## 4. Tests

- [x] 4.1 Resolution ranking
- [x] 4.2 Recency tie-break within tolerance; finer beats newer coarse
- [x] 4.3 Spatial filtering (overlap, global) and zoom over-zoom exclusion
- [x] 4.4 Fallback queue + null selection
- [x] 4.5 Registry integration (brief providers present, key-gated auth, Zurich → ortho-ch, ocean → global)
- [x] 4.6 Cache TTL expiry and LRU eviction
- [x] 4.7 Run `npx jest __tests__/unit/tileRouter.test.ts __tests__/unit/mapStyles.test.ts --runInBand` — 37 passed

## 5. Quality gates

- [x] 5.1 `pnpm typecheck` — clean
- [x] 5.2 `pnpm lint` — 0 errors (pre-existing warnings only)
- [x] 5.3 `pnpm format:check` — clean

## 6. Fallback (native-safe)

- [x] 6.1 Resolve OpenAerialMap to a real tile template (dynamic STAC/TiTiler mosaic, `?assets=visual`) — verified `200 image/png`
- [x] 6.2 Implement native-safe fallback (`tileFallback.ts`): `withFallbackTiles`/`withGlobalFallback`/`rankedFallbackTileUrls`
- [x] 6.3 Wire regional sources to fall back to the global base, and the global base to fall back to GIBS Landsat
- [x] 6.4 Tests: `__tests__/unit/tileFallback.test.ts` — chains, dedup, ranking order, style wiring
- [ ] 6.5 Native timeout-based switching (custom protocol or local proxy) — deferred; MapLibre Native has no `addProtocol` and the existing `PolarisTileServer` is disk-only and not config-plugin-wired. Only needed if timeout (not 404) switching is required.
- [x] 6.6 Runtime viewport layer manager — `satelliteRuntimeStyle.ts` + `useSatelliteViewportStyle` consume the router on camera settle (viewport-eligible regional providers capped by overlap, curated order, per-provider attribution) and add OpenAerialMap where `oamCoverage.ts` finds STAC footprints. Tests: `__tests__/unit/satelliteRuntimeStyle.test.ts`, `__tests__/unit/oamCoverage.test.ts`
- [x] 6.7 Attribution panel — `MapAttribution` surfaces the visible imagery attributions (MapLibre's own control is off app-wide); `viewportImageryAttributions` supplies them. Applies the scoped style on entering satellite mode without a pan.
- [x] 6.8 Sentinel-2 freshness — `sentinelStac.ts` discovers the newest low-cloud L2A scene over the viewport (Earth Search STAC, cached) and the attribution panel shows its date/cloud. Tests: `__tests__/unit/sentinelStac.test.ts`
