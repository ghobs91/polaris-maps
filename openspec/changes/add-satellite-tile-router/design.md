## Context

The satellite style is built statically from `src/constants/orthophotoSources.ts` (28 regional providers) plus inline global sources (EOx Sentinel-2, USGS NAIP) in `src/constants/satelliteStyle.ts`. The brief asks for a dynamic engine that picks the highest-resolution source per viewport with recency as tie-breaker and per-tile fallback.

This app renders with **MapLibre Native** (`@maplibre/maplibre-react-native` 10.4.2). Native MapLibre exposes no `addProtocol`/custom-URL-protocol hook — a fact already documented in `specs/001-p2p-depin-mapping/research.md`. So the brief's `satellite://{z}/{x}/{y}` custom protocol and true runtime per-tile switching are not available without native code or a local proxy. The engine is therefore implemented as a pure selection module, and the native style keeps using bounded layers + multi-URL `tiles` fallback.

## Goals / Non-Goals

**Goals:**

- Deterministic `selectBestTileSource(bbox, zoom)` over a unified registry, with resolution-primary ranking and recency tie-breaking.
- Spatial + zoom filtering with an explicit over-zoom allowance.
- A fallback queue in rank order.
- TTL + LRU cache for STAC metadata.
- Unit tests for ranking, recency, filtering, fallback, and cache behaviour.

**Non-Goals:**

- No custom URL protocol and no per-tile runtime switching (native MapLibre can't; would need native/proxy work).
- No live STAC fetch wired into the render path (cache + endpoint are provided; wiring is follow-up).
- No change to the existing curated layer ordering in `satelliteStyle.ts` (see Decision 4).
- No new dependencies.

## Decisions

### Decision 1: Pure engine, separate from rendering

`tileRouter.ts` has no MapLibre dependency; it takes a viewport `bbox` and `zoom` and returns ranked `ImagerySource` objects. This is unit-testable and reusable regardless of the render backend.

### Decision 2: Resolution primary, recency within tolerance

Sort by `resolutionM` ascending. Sources within `resolutionTolerance` (±10% of the finer value) are considered equal resolution and sorted by `acquiredAt` descending. Equal resolution+recency falls back to `id` for determinism.

**Rationale:** A comparator with a tolerance window is not transitive; grouping near-equal resolutions before the recency sort produces a strict total order.

### Decision 3: Zoom filtering with bounded over-zoom

A source is eligible when `minzoom ≤ zoom ≤ maxzoom + maxOverzoom` (default 2). This excludes sources that would be upscaled far past their native resolution while still allowing minor over-zoom.

### Decision 4: Native layer order stays curated; router is the selector

`satelliteStyle.ts` keeps its curated layer order because resolution-sorting would place a finer provider (e.g. Spain, 0.25 m) above a coarser one (Portugal, 0.3 m) whose bounds it encloses; blank ES tiles over Portugal would then hide the PT layer. Overlap correctness in native rendering depends on ordering narrower providers later, which resolution alone does not guarantee.

**Consequence:** the router is the selection/ranking implementation and the feed for a future runtime layer manager or native protocol handler; the current static style is not reordered by it.

### Decision 5: OpenAerialMap is renderable but not emitted globally

OAM's legacy TMS host is retired (404), but its dynamic STAC/TiTiler mosaic works: `https://api.imagery.hotosm.org/raster/collections/openaerialmap/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=visual` was verified returning `200 image/png`. Coverage is patchy (only contributed scenes), so OAM is in the router registry (selectable where it covers the viewport) but is **not** emitted as a global layer by `satelliteStyle.ts`, which would request it worldwide and mostly 404. The STAC search URL is also exposed for metadata use with the cache.

### Decision 6: Verified global providers

EOx Sentinel-2, USGS NAIP, and NASA GIBS Landsat/MODIS/VIIRS templates were live-probed (`200` image bytes). LINZ is key-gated (`?api=`), so it uses the existing env-gated `auth` mechanism.

### Decision 7: Native-safe fallback via multi-URL `tiles`

MapLibre requests the next tile URL in a source's `tiles` array only when the previous one errors (404 / network failure). So each regional raster source's `tiles` is `[...provider, <global base>]`, and the global base is `[EOx Sentinel-2, GIBS Landsat]`. A missing provider tile degrades to global imagery instead of a gap, at no extra request cost while the primary succeeds. This implements the brief's "graceful degradation" (Step 4) without a custom protocol.

**Alternative considered:** a native local proxy for timeout-based switching. Rejected for now: it adds iOS-only native code that cannot be build-verified in this environment, and the existing `PolarisTileServer` serves only disk files and is not wired through a config plugin. The proxy remains a documented future option if timeout switching is needed.

### Decision 8: Runtime viewport layer manager consumes the engine (no native protocol)

The router is wired into rendering without native code: `satelliteRuntimeStyle.ts` narrows the mounted regional providers to those that pass the router's spatial + zoom eligibility for the current viewport, and `useSatelliteViewportStyle` rebuilds the satellite style on camera settle — only when the serving provider set or OAM coverage changes, so ordinary panning does not churn `MapView`'s `mapStyle`. The global base, US NAIP overlays, labels, per-provider attribution, and the curated overlap order are unchanged; `satelliteStyle.ts` now exposes `buildSatelliteStyleJson(providers)` with the full registry as the default.

OpenAerialMap has no fixed footprint, so `oamCoverage.ts` queries the OAM STAC search for the viewport (cached 5 min) and mounts the OAM mosaic bounded to the union of intersecting footprints — only where imagery actually exists. The mounted set is capped at `DEFAULT_MAX_VIEWPORT_SOURCES` (8) by viewport overlap, so a continental viewport does not mount every provider. `viewportImageryAttributions` supplies the map's attribution panel (MapLibre's own control is disabled app-wide), and `sentinelStac.ts` reports the freshest Sentinel-2 scene over the viewport for that panel.

**Consequence:** the engine is no longer test-only. Per-tile **timeout** switching is still not expressible, so the native-safe multi-URL fallback (Decision 7) remains the failure path.

## Risks / Trade-offs

- **Runtime-consumer risk.** The engine now runs on camera settle via `useSatelliteViewportStyle`. It rebuilds `mapStyle` only when the serving provider set (or OAM coverage) changes, so panning within one provider does not churn the style; the remaining risk is the extra `mapStyle` swap when crossing provider boundaries, which reloads the raster style.
- **Metadata is approximate.** `resolutionM`/`acquiredAt` are nominal values; ranking is only as good as the registry metadata.
- **STAC discovery is viewport-driven.** OpenAerialMap coverage and the latest Sentinel-2 scene are fetched per viewport through their STAC searches (cached), best-effort; a lookup failure never affects rendering. Sentinel-2 scene _imagery_ is not rendered — the base stays the static cloudless mosaic, and only freshness is surfaced.
