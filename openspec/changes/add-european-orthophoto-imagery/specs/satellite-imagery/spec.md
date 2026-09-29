## ADDED Requirements

### Requirement: Regional orthophoto provider registry

The system SHALL define a typed registry, `REGIONAL_ORTHOPHOTO_SOURCES`, in `src/constants/orthophotoSources.ts`, where each entry declares a stable `id`, a `label`, one or more `tiles` URL templates containing `{z}`/`{x}`/`{y}` (tiled) or `{bbox-epsg-3857}` (WMS), a `tileSize`, an optional `scheme`, a native `maxzoom`, an `attribution` string, a `bounds` array of `[west, south, east, north]`, and optional free-key `auth` parameters.

#### Scenario: Registry contains the European providers

- **WHEN** `REGIONAL_ORTHOPHOTO_SOURCES` is read at runtime
- **THEN** it contains entries for Switzerland, Netherlands, France, Austria, Spain, Portugal, Belgium, Luxembourg, Poland, Czechia, Slovenia, Hungary, Estonia, Denmark, Germany (NRW/Bavaria/Saxony), Finland, Iceland, Lithuania, Liechtenstein, Italy (national + Lazio), Greece, Malta, Cyprus, Slovakia (Bratislava), and Croatia
- **AND** every entry has a non-empty `attribution` and a four-number `bounds` array

#### Scenario: Every tile template is usable by MapLibre

- **WHEN** a registry entry's `tiles[0]` is inspected
- **THEN** it contains either `{z}`, `{x}`, `{y}` or `{bbox-epsg-3857}` placeholders

### Requirement: One bounded raster source per provider

For each registry entry, the satellite style SHALL emit exactly one MapLibre raster source with a `bounds` value equal to that entry's bounds, plus a matching raster layer referencing it.

#### Scenario: Out-of-coverage tiles are not requested

- **WHEN** the map viewport is entirely outside a provider's bounds
- **THEN** MapLibre does not request tiles from that provider's source

#### Scenario: Source and layer counts match the enabled registry

- **WHEN** the satellite style JSON is parsed
- **THEN** for every enabled registry entry there is one raster source whose id is derived from the entry's `id`
- **AND** there is one raster layer bound to that source

#### Scenario: Free-key providers are omitted when unconfigured

- **WHEN** a registry entry declares `auth` env vars that are not set
- **THEN** no raster source or layer is emitted for that entry
- **AND** the remaining providers still render

### Requirement: Regional imagery layers above the global base and below labels

Regional orthophoto raster layers SHALL be ordered after the global base raster layer and after the NAIP raster layer, and before every vector label layer.

#### Scenario: Regional imagery covers the global base

- **WHEN** the satellite style is rendered over a region with a registered provider
- **THEN** the provider's raster layer draws above `satellite-global-tiles`
- **AND** all `type: 'symbol'` label layers draw above the provider's raster layer

### Requirement: Imagery sources do not over-zoom past native resolution

Every raster source's `maxzoom` SHALL equal its data's native maximum zoom, so MapLibre does not upscale tiles far beyond their resolution. In particular, the global EOx Sentinel-2 source SHALL NOT declare a `maxzoom` greater than its native maximum.

#### Scenario: Global source is not over-zoomed

- **WHEN** the satellite style JSON is parsed
- **THEN** `sources['satellite-global'].maxzoom` is less than 19
- **AND** it is at least the zoom at which the 10 m mosaic tiles are natively available

#### Scenario: Regional sources use native max zoom

- **WHEN** a registered provider's source is inspected
- **THEN** its `maxzoom` equals the registry entry's `maxzoom`

### Requirement: Providers are openly licensed; free keys are env-gated

Each registered provider SHALL use a tile endpoint whose data is licensed for reuse with attribution. A provider MAY require a free account credential; when it does, that credential SHALL be supplied through `EXPO_PUBLIC_*` environment variables, the provider SHALL be omitted when they are unset, and no credential SHALL be committed in source.

#### Scenario: No credentials in committed tile templates

- **WHEN** any registry `tiles` template is inspected
- **THEN** it contains no API key, token, user name, or password literal

#### Scenario: Keyed provider activates only with credentials

- **WHEN** the env vars named by a provider's `auth` entries are all set
- **THEN** the emitted source tile URLs include the credential as a query parameter
- **AND** when any are unset the provider is omitted

### Requirement: Visible imagery attribution is preserved

Each regional raster source SHALL carry its provider's required attribution, and the map SHALL surface the attribution of currently visible imagery sources.

#### Scenario: Provider attribution appears when its country is visible

- **WHEN** the map is centred on a country with a registered provider
- **THEN** that provider's attribution string is present in the map's attribution for the visible sources

### Requirement: Graceful fallback outside provider coverage

Where no regional provider covers the viewport, or a provider request fails, the map SHALL fall back to the global base imagery without error.

#### Scenario: Ocean or uncovered land falls back to global

- **WHEN** the map is centred where no registered provider has coverage
- **THEN** the global EOx base remains visible
- **AND** no error or empty map is shown

#### Scenario: Provider request failure degrades to global

- **WHEN** a regional provider's tiles fail to load
- **THEN** the global base imagery remains visible beneath it
