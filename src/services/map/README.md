# map

Map style, offline tile handling, and satellite tile routing.

| File                   | Responsibility                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tileRouter.ts`        | Pure, platform-agnostic tile selection engine: spatial/zoom filtering, resolution ranking, recency tie-break, fallback queue, and a TTL+LRU metadata cache.                                                            |
| `tileFallback.ts`      | Native-safe fallback chains: ordered multi-URL `tiles` (MapLibre tries the next URL only on error), plus `rankedFallbackTileUrls`.                                                                                     |
| `imagerySources.ts`    | Unified imagery registry (`IMAGERY_SOURCES`) combining global satellite/aerial providers with the regional orthophoto registry in `src/constants/orthophotoSources.ts`; exports `selectBestImagerySource(bbox, zoom)`. |
| `tileService.ts`       | Runtime tile fetching/caching used by the map.                                                                                                                                                                         |
| `offlineStyle.ts`      | Offline style rewriting (vector tiles to local source, online raster dropped).                                                                                                                                         |
| `offlineMapService.ts` | Offline pack lifecycle.                                                                                                                                                                                                |
| `navFocusStyle.ts`     | Navigation-focus style rewriting.                                                                                                                                                                                      |

## Tile routing contract

`selectBestTileSource(viewport, zoom, sources, options)` (or `selectBestImagerySource(bbox, zoom)`, which defaults to `IMAGERY_SOURCES`) returns `{ selected, ranked }`:

1. **Filter** sources to those covering the viewport (`bounds`; `null` = global) and supporting `zoom` within `maxOverzoom` (default 2).
2. **Rank** by `resolutionM` ascending (finer first).
3. **Tie-break** within `resolutionTolerance` (default ±10 %) by `acquiredAt` descending (newer first).
4. **Stabilise** by `id` so ordering is deterministic.
5. `ranked` doubles as the **fallback queue**.

Near-equal resolutions are grouped before the recency sort so the ordering stays a strict total order.

`createTileMetadataCache({ ttlMs, max })` is an in-memory TTL + LRU cache for STAC/search responses (e.g. `OAM_STAC_SEARCH_URL`).

## Platform note (important)

This app renders with **MapLibre Native** (`@maplibre/maplibre-react-native`). Native MapLibre does **not** support a custom URL protocol (`addProtocol`); that API exists only in MapLibre GL JS. Therefore runtime per-tile source switching is not driven directly from the router. The native integration uses:

- one bounded raster source/layer per regional provider (`bounds` + `maxzoom`), and
- multi-URL `tiles` arrays (MapLibre requests the next URL only when one errors) as the fallback. Each regional source appends the global base, and the global base appends a second global provider, so a failed tile degrades to coarser imagery instead of a gap.

404/network fallback is therefore fully handled without native code. **Timeout-based** switching is not expressible in a style and would need a custom protocol handler or local proxy (see the deferred task in `add-satellite-tile-router`).

The router remains the single selection/ranking implementation and is the input to a runtime layer manager should a native protocol handler or local proxy be added later.
