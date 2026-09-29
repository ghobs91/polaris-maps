## Why

The satellite map type can be served by many imagery providers with different resolutions, coverage, and recency, but the app has no deterministic way to choose the best one for a viewport. This adds a tile selection/routing engine that ranks sources by resolution with recency as a tie-breaker, and exposes a fallback queue, so the highest-resolution imagery available is used wherever it exists.

## What Changes

- Add a unified imagery source registry combining global providers (Sentinel-2/EOx, USGS NAIP, NASA GIBS Landsat/MODIS/VIIRS, OpenAerialMap STAC) with the existing regional orthophoto registry.
- Add `resolutionM` and `acquiredAt` to the regional orthophoto registry so sources are rankable.
- Add the `TileRouter` engine: `selectBestTileSource(bbox, zoom)` / `rankImagerySources`, with spatial + zoom filtering, resolution-primary ranking, recency tie-break within a ±10% resolution window, deterministic id tie-break, and a fallback queue.
- Add an in-memory TTL + LRU cache for STAC/search metadata (`createTileMetadataCache`).
- Document the native integration constraint: MapLibre Native has no custom URL protocol, so the engine is the selection implementation while the style uses bounded layers + multi-URL `tiles` fallback.

## Capabilities

### New Capabilities

- `tile-routing`: deterministic imagery source ranking/selection (spatial + zoom filtering, resolution ranking, recency tie-break, fallback queue) and the imagery source registry that feeds it.

### Modified Capabilities

None.

## Impact

- `src/services/map/tileRouter.ts` — **new** selection engine + metadata cache.
- `src/services/map/imagerySources.ts` — **new** unified registry + convenience selectors.
- `src/services/map/README.md` — **new** contract + platform note.
- `src/constants/orthophotoSources.ts` — add `resolutionM`, `acquiredAt`, `minzoom`, and the LINZ (New Zealand) source.
- `__tests__/unit/tileRouter.test.ts` — **new** unit tests.
- No new dependencies. No runtime network behaviour added (STAC caching is available but not wired to a live fetch).
