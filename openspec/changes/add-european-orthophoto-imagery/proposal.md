## Why

Outside the US, the satellite map type falls back to a single global EOx Sentinel-2 layer (~10 m/px) and the style over-zooms it to z19, so imagery looks very blurry. The only high-resolution layer today is US-only NAIP. Most European countries publish open, sub-meter orthophoto services under permissive licences (OGD/CC-BY/CC0/dl-de), which can be layered on top of the global base exactly like NAIP — per country, and bounded to their coverage.

## What Changes

- Add an extensible registry of **European orthophoto sources** — Switzerland, Netherlands, France, Austria, Spain, Portugal, Belgium, Luxembourg, Poland, Czechia, Slovenia, Hungary, Estonia, Denmark, Germany (NRW/Bavaria/Saxony), Finland, Iceland, Lithuania, Liechtenstein, Italy (national + Lazio), Malta, Cyprus, Slovakia (Bratislava), and Croatia (27 entries). Both tiled services (XYZ/WMTS) and WMS/Map services (via `{bbox-epsg-3857}`) are supported. Greece was dropped: its YPEN proxy responds `200 image/jpeg` but returns the same blank tile for every location, so it serves no imagery.
- Support **free-key providers** (Denmark, Finland) through `EXPO_PUBLIC_*` env vars: the provider is emitted only when the credential is set, so no secret is committed and the layer never renders broken.
- Emit one MapLibre raster source + raster layer per enabled provider, stacked above the global EOx base and above NAIP, below the vector labels.
- Give every regional raster source a `bounds` so tiles are only requested inside its coverage (no worldwide 404 storm like the NAIP layer causes today).
- Fix the global EOx layer's `maxzoom` so MapLibre stops over-zooming low-resolution tiles to z19 (a major cause of the current blur); regional layers use each provider's native max zoom.
- Preserve per-source attribution strings; add unit tests asserting registry shape, placeholder validity, env gating, and no committed credentials.

## Capabilities

### New Capabilities

- `satellite-imagery`: Selection, layering, bounds, native zoom, and attribution behaviour of the satellite map type's raster imagery (global base, US NAIP overlay, and regional orthophoto overlays), including the provider registry that drives the regional overlays.

### Modified Capabilities

None.

## Impact

- `src/constants/satelliteStyle.ts` — build global/NAIP/regional raster sources and layers from the registry; resolve env-gated auth; correct the global `maxzoom`.
- `src/constants/orthophotoSources.ts` — **new** registry of regional providers (id, tiles, scheme, maxzoom, attribution, bounds, licence, optional auth).
- `.env.example` — document the optional Denmark credentials.
- `__tests__/unit/mapStyles.test.ts` — extend satellite-style assertions for regional sources, bounds, native zoom, attribution, placeholders, env gating, and credential hygiene.
- No new dependencies; no changes to `mapStyleResolver.ts` or the map view (the style JSON already flows through unchanged). Keyless providers require no configuration.
