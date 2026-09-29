## ADDED Requirements

### Requirement: Imagery source registry

The system SHALL define `IMAGERY_SOURCES` in `src/services/map/imagerySources.ts`, combining global providers and the regional orthophoto registry, where each source declares `id`, `label`, `kind`, `tiles`, `tileSize`, `minzoom`, `maxzoom`, `resolutionM`, `acquiredAt`, `attribution`, and `bounds` (or `null` for a global source).

#### Scenario: Brief providers are registered

- **WHEN** `IMAGERY_SOURCES` is read
- **THEN** it contains OpenAerialMap, USGS NAIP, Landsat (GIBS), MODIS/VIIRS (GIBS), and Sentinel-2, plus the regional orthophotos

#### Scenario: Global sources are unbounded

- **WHEN** a global provider (e.g. Sentinel-2) is inspected
- **THEN** its `bounds` is `null`

### Requirement: Resolution-primary ranking with recency tie-break

`rankImagerySources(viewport, zoom, sources)` SHALL filter sources to those covering the viewport and supporting the zoom, then rank by `resolutionM` ascending, breaking near-equal resolutions (within ±10%) by `acquiredAt` descending, and breaking remaining ties by `id`.

#### Scenario: Finer resolution ranks ahead

- **WHEN** sources of 0.1 m, 0.3 m, and 10 m all cover the viewport
- **THEN** the ranked order is 0.1 m, 0.3 m, 10 m

#### Scenario: Recency breaks a near-equal tie

- **WHEN** two sources are within 10% resolution of each other
- **THEN** the more recent `acquiredAt` ranks first

#### Scenario: Finer resolution beats a newer coarse source

- **WHEN** a 0.1 m source from 2012 and a 0.2 m source from 2026 both cover the viewport
- **THEN** the 0.1 m source ranks first

### Requirement: Spatial and zoom filtering

Ranking SHALL exclude sources whose bounds do not intersect the viewport, and sources where `zoom` exceeds `maxzoom + maxOverzoom` (default 2). Global sources (`bounds: null`) SHALL always pass the spatial filter.

#### Scenario: Non-overlapping sources excluded

- **WHEN** the viewport is over Spain
- **THEN** a New Zealand source is excluded and a Spain source is included

#### Scenario: Excessive over-zoom excluded

- **WHEN** a source has `maxzoom` 9 and the requested zoom is 14
- **THEN** it is excluded

### Requirement: Fallback queue

`selectBestTileSource(viewport, zoom, sources)` SHALL return `{ selected, ranked }` where `selected` is the top-ranked source (or `null` when none qualify) and `ranked` is the ordered fallback queue.

#### Scenario: Best source plus ordered queue

- **WHEN** three sources can serve the viewport
- **THEN** `selected` is the best and `ranked` is all three, best first

#### Scenario: Nothing qualifies

- **WHEN** no source covers the viewport at the requested zoom
- **THEN** `selected` is `null` and `ranked` is empty

### Requirement: STAC metadata cache

The system SHALL provide `createTileMetadataCache({ ttlMs, max })` with `get`/`set`/`has`/`clear`/`size`, expiring entries after the TTL and evicting the least-recently-used entry past `max`.

#### Scenario: Entries expire

- **WHEN** an entry's TTL has elapsed
- **THEN** `get` returns `undefined` and the entry is removed

#### Scenario: LRU eviction

- **WHEN** more than `max` entries are set
- **THEN** the least-recently-used entry is evicted

### Requirement: Native-safe tile fallback via multi-URL sources

The satellite style SHALL append a global fallback tile URL to each regional provider's `tiles` (so a failed provider tile degrades to global imagery), and SHALL list a second global provider behind the primary global base, using MapLibre's ordered multi-URL fallback (next URL requested only on error).

#### Scenario: Regional provider falls back to the global base

- **WHEN** any `ortho-*` raster source in the style JSON is inspected
- **THEN** its `tiles` array has the provider template first and the global EOx template last

#### Scenario: Global base has an outage fallback

- **WHEN** the `satellite-global` source is inspected
- **THEN** its `tiles` array contains the EOx mosaic followed by a second global provider (NASA GIBS Landsat)

### Requirement: Native integration constraint is documented

The module SHALL document that MapLibre Native has no custom URL protocol, so runtime per-tile switching is not driven directly from the router and the native style uses bounded layers plus multi-URL `tiles` fallback.

#### Scenario: Platform note present

- **WHEN** `src/services/map/README.md` is read
- **THEN** it states the no-custom-protocol constraint and the native fallback mechanism
