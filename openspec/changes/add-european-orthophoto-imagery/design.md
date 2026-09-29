## Context

`src/constants/satelliteStyle.ts` defines a single MapLibre style with three raster sources: `satellite-global` (EOx Sentinel-2 cloudless, ~10 m, `maxzoom: 19`), `satellite-naip` (USGS NAIP, ~1 m, `maxzoom: 19`), and the OpenFreeMap vector label source. Regional high-resolution imagery exists only for the US. Outside the US the map shows the global layer, and because the global source declares `maxzoom: 19` on a ~10 m dataset, MapLibre over-zooms the tiles far past their native resolution — the primary cause of the "very low res" appearance.

MapLibre raster sources support `bounds` ("Tiles outside these bounds will not be requested") and a `scheme` of `xyz` or `tms`. This lets a regional provider be declared as a normal raster source that only fetches tiles inside its country, without the 404-fall-through behaviour the NAIP layer relies on. MapLibre also accepts arbitrary URL templates in `tiles`, so KVP WMTS services can be expressed directly by embedding `{z}`/`{x}`/`{y}` in the query string.

The current change is structurally analogous to `add-european-transit-data`: a small registry of providers keyed to national footprints, layered over a global fallback.

## Goals / Non-Goals

**Goals:**

- Add European orthophoto providers across as many countries as are fetchable: Switzerland, Netherlands, France, Austria, Spain, Portugal, Belgium, Luxembourg, Poland, Czechia, Slovenia, Hungary, Estonia, Denmark, Germany (NRW/Bavaria/Saxony), Finland, Iceland, Lithuania, Liechtenstein, Italy (national + Lazio), Greece, Malta, Cyprus, Slovakia (Bratislava), Croatia — 28 entries. Some are partial (coverage), HTTP-only, or licence-unverified; each is labelled in the registry.
- Support both tiled (XYZ/WMTS with `{z}/{x}/{y}`) and WMS/Map services (via MapLibre's `{bbox-epsg-3857}`).
- Emit one raster source + layer per enabled provider from a single typed registry, stacked above the global base and bounded to its coverage.
- Support free-key providers behind `EXPO_PUBLIC_*` env vars, omitted when unset.
- Stop over-zooming the global EOx layer; set each source's `maxzoom` to its native maximum.
- Keep per-provider attribution visible.
- Leave `mapStyleResolver.ts`, the map view, stores, and native code untouched.

**Non-Goals:**

- No commercial/ToS-bound providers (e.g. Esri World Imagery) and no paid/agreement-key services.
- No per-country vector labels, no label translation, no opacity/blend tuning beyond existing values.
- No coverage claim for countries without a usable open service; those are documented as excluded.
- No dynamic bbox querying or runtime provider discovery — the registry is static and compiled in.
- No offline pack integration for regional imagery (the offline style already drops online raster sources).
- No proxy/tile-rewrite backend: every endpoint must be directly consumable as a MapLibre raster source template.

## Decisions

### Decision 1: One bounded raster source per provider

Each provider becomes its own raster source with a `bounds` array (`[west, south, east, north]`) and its own layer, rather than one multi-URL source or NAIP-style 404 fall-through.

**Rationale:** `bounds` prevents out-of-country tile requests entirely, so the providers do not produce a worldwide stream of 404s. Separate sources also keep per-provider `maxzoom`, `scheme`, attribution, and tile ordering independent, and let MapLibre attribute the visible source correctly.

**Alternative considered:** A single `satellite-regional` source with all provider URLs in `tiles`. Rejected — MapLibre would try every provider for every tile worldwide, and per-country bounds/maxzoom/scheme would be impossible.

**Alternative considered:** 404 fall-through like NAIP (no bounds). Rejected — multiplies failed requests by provider count and wastes radio on mobile.

### Decision 2: Open-licensed endpoints; free keys are env-gated

Providers are registered when their data is licensed for reuse with attribution. Keyless services are preferred, but a provider that requires a _free_ account credential may be registered behind `EXPO_PUBLIC_*` env vars, and is omitted when those vars are unset. Paid/agreement-key and unclear-licence services are excluded.

**Rationale:** Keeps the open-data stance and avoids committing secrets or shipping broken layers. The gating is data-driven, so adding another keyed provider is a registry edit.

**Outcome:** Denmark (env-gated creds) and Finland (env-gated free `api-key`) are registered behind auth. Keyless additions: Iceland, Lithuania, Liechtenstein, Italy (national HTTP + Lazio HTTPS), Greece (HTTP), Malta, Cyprus, Slovakia (Bratislava), Croatia. Genuinely impossible (documented, not registered): Norway (token minted from credentials + restricted "Norge digitalt" agreement), Sweden (HTTP Basic/OAuth + Geotorget entitlement, COG-only), Latvia (401 / blank export), Ireland (MapGenie login), UK (commercial key; NI coast only), Andorra (OGC host dead), Monaco (no public service), Serbia (hosts unreachable), Bosnia (Cloudflare 403), Romania (DNS down after ransomware). The registry makes re-adding any of these a one-object change.

### Decision 3: Encode XYZ, WMTS, WMS and OGC API Maps as MapLibre URL templates

The registry stores a `tiles` template per provider. REST XYZ services use path templating; KVP WMTS services embed `{z}`/`{x}`/`{y}` in the query string; WMS and ArcGIS/Map endpoints embed `{bbox-epsg-3857}`; providers whose axes are not `z/x/y` (e.g. `google3857`, ArcGIS WMTS) use the correct placeholder order and/or `scheme: 'tms'`.

**Rationale:** MapLibre substitutes `{z}`, `{x}`, `{y}` and `{bbox-epsg-3857}` anywhere in the URL (the last with a `width`/`height` tile size), so no proxy or tile-rewriting layer is needed.

**Consequence:** Exact layer names, matrix-set IDs, axis order, and file extensions must be pinned from each provider's `GetCapabilities` and verified with a live probe rather than guessed. See the provider table and tasks.md.

### Decision 8: Free-key auth is a generic list of env-sourced query params

A registry entry may declare `auth: Array<{ name: string; envVar: string }>`. At style-build time each param is read from `process.env[envVar]`; if any is missing the provider is skipped entirely, otherwise the params are appended to every tile URL. This covers providers (Denmark) whose credential is a query `username`/`password` or token.

**Rationale:** MapLibre style sources cannot carry per-source HTTP headers, so header-only auth is out of scope; all registered keyed providers use query-param auth. Single mechanism, no special-casing.

**Alternative considered:** Inlining the publicly-published Dataforsyningen credentials. Rejected — they are a shared account that can rotate, and committing credentials violates the project's secret policy.

### Verified provider facts (endpoints pinned and probed during implementation)

Every registered endpoint was fetched live and returned HTTP 200 image bytes (`image/jpeg` or `image/png`) at the sampled location.

| Country       | Provider / layer                 | Licence                       | Res.       | Maxz | Access       | Verified endpoint                                                                           |
| ------------- | -------------------------------- | ----------------------------- | ---------- | ---- | ------------ | ------------------------------------------------------------------------------------------- |
| Switzerland   | swisstopo `swissimage`           | swisstopo OGD                 | 10 cm      | 20   | keyless      | `wmts.geo.admin.ch/.../swissimage/default/current/3857/{z}/{x}/{y}.jpeg`                    |
| Netherlands   | PDOK `Actueel_orthoHR`           | PDOK open                     | 5–8 cm     | 21   | keyless      | `service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg`     |
| France        | IGN `ORTHOIMAGERY.ORTHOPHOTOS`   | Licence Ouverte / Etalab      | 20 cm      | 19   | keyless      | KVP WMTS `data.geopf.fr/wmts?...TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`    |
| Austria       | basemap.at `bmaporthofoto30cm`   | OGD Austria / CC-BY 4.0       | 30 cm      | 20   | keyless      | `maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg` (`z/y/x`)    |
| Spain         | IGN PNOA `OI.OrthoimageCoverage` | CC BY 4.0                     | 25–50 cm   | 19   | keyless      | WMTS `ign.es/wmts/pnoa-ma?...GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`   |
| Portugal      | DGT `ortos-rgb` (OGC API Maps)   | CC-BY 4.0                     | 30 cm      | 19   | keyless      | `ogcapi.dgterritorio.gov.pt/collections/ortos-rgb/map?...bbox={bbox-epsg-3857}`             |
| Belgium       | NGI/IGN `orthoimage_coverage`    | CC BY 4.0                     | 12.5–25 cm | 19   | keyless      | WMTS `wmts.ngi.be/inspire/ortho/1.0.0/orthoimage_coverage/.../{z}/{y}/{x}.png`              |
| Luxembourg    | ACT `OI_OrthoimageCoverage_RGB`  | CC0                           | 10 cm      | 20   | keyless      | WMS `wms.inspire.geoportail.lu/geoserver/wms?...bbox={bbox-epsg-3857}`                      |
| Poland        | GUGiK `ORTOFOTOMAPA`             | OGD (free reuse)              | 25 cm      | 19   | keyless      | WMTS `mapy.geoportal.gov.pl/.../ORTO/WMTS/StandardResolution?...tileRow={y}&tileCol={x}`    |
| Czechia       | ČÚZK `ORTOFOTO_WM`               | free reuse (ČÚZK)             | 20 cm      | 18   | keyless      | ArcGIS WMTS `ags.cuzk.gov.cz/.../GoogleMapsCompatible/{z}/{y}/{x}`                          |
| Slovenia      | GURS `DOF025_3857`               | CC BY 4.0                     | 25 cm      | 19   | keyless      | WMS `ipi.eprostor.gov.si/wms-si-gurs-dts/wms?...BBOX={bbox-epsg-3857}`                      |
| Hungary       | Lechner `OrthoimageCoverage2023` | free gov use                  | ≈40–50 cm  | 18   | keyless      | WMS `inspire.lechnerkozpont.hu/geoserver/OI.2023/wms?...BBOX={bbox-epsg-3857}`              |
| Estonia       | Maa- ja Ruumiamet `foto`         | open (Maa-amet)               | ≈60 cm     | 18   | keyless      | WMTS `tiles.maaamet.ee/tm/wmts?...tilematrixset=GMC&TileMatrix={z}&TileRow={y}&TileCol={x}` |
| Denmark       | Datafordeler `orto_foraar_webm`  | open (Dataforsyningen)        | 10–20 cm   | 20   | env-gated    | `services.datafordeler.dk/.../{z}/{y}/{x}.jpg` + `username`/`password`                      |
| Germany (NRW) | Geobasis NRW `nw_dop_rgb`        | Datenlizenz Zero 2.0          | 20 cm      | 19   | keyless      | WMS `www.wms.nrw.de/geobasis/wms_nw_dop?...bbox={bbox-epsg-3857}`                           |
| Germany (BY)  | `by_dop20c`                      | CC BY 4.0                     | 20 cm      | 19   | keyless      | WMS `geoservices.bayern.de/od/wms/dop/v1/dop20?...bbox={bbox-epsg-3857}`                    |
| Germany (SN)  | `sn_dop_020`                     | dl-de/by-2-0                  | 20 cm      | 19   | keyless      | WMS `geodienste.sachsen.de/wms_geosn_dop-rgb/guest?...bbox={bbox-epsg-3857}`                |
| Finland       | MML `ortokuva` (open WMTS)       | NLS open / CC BY 4.0          | ~50 cm     | 16   | env-key      | `avoin-karttakuva.../ortokuva/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.jpg?api-key=`       |
| Iceland       | LMÍ `loftmyndir_hnitsettar`      | LMÍ terms                     | varies     | 19   | keyless      | WMS `gis.lmi.is/geoserver/wms?...srs=EPSG:3857&bbox={bbox-epsg-3857}`                       |
| Lithuania     | RRT `Ortofoto`                   | **licence unverified**        | cached     | 19   | keyless      | ArcGIS `arcgis.rrt.lt/.../Ortofoto/MapServer/export?...imageSR=3857`                        |
| Liechtenstein | LLV `li.atg.orthophoto2025`      | **non-commercial only**       | 10 cm      | 20   | keyless      | WMS `service.geo.llv.li/service/wms?...bbox={bbox-epsg-3857}`                               |
| Italy         | PCN `ortofoto_colore_12`         | attribution (no open licence) | 50 cm      | 19   | keyless HTTP | WMS `wms.pcn.minambiente.it/ogc?...CRS=EPSG:3857`                                           |
| Italy (Lazio) | Lazio AGEA 2023                  | CC BY 4.0                     | 20 cm      | 19   | keyless      | WMS `geoportale.regione.lazio.it/geoserver/ows?...CRS=EPSG:3857`                            |
| Greece        | YPEN `ktimatologio`              | CC BY-SA 2.0 (use caveat)     | 20–50 cm   | 19   | keyless HTTP | WMS `geoportal.ypen.gr/tiles/service?...CRS=EPSG:3857`                                      |
| Malta         | ERAPortal ortho 2012             | **licence unverified**        | 2012       | 18   | keyless      | ArcGIS `eraportal.org.mt/.../Orthophoto_External/MapServer/export?...imageSR=3857`          |
| Cyprus        | DLS ortho 2014                   | CC BY 4.0 (royalties note)    | 10 cm      | 19   | keyless      | WMS `eservices.dls.moi.gov.cy/.../Imagery_Orthophoto_2014_10cm/.../WmsServer`               |
| Slovakia (BA) | City of Bratislava ortho 2021    | **licence unverified**        | 10–20 cm   | 19   | keyless      | ArcGIS tiles `geoportal.bratislava.sk/.../Ortofoto_2021/MapServer/tile/{z}/{y}/{x}`         |
| Croatia       | DGU `DOF`                        | DGU terms (attribution)       | 2011       | 19   | keyless      | WMS `geoportal.dgu.hr/ows?...CRS=EPSG:3857`                                                 |

Impossible (documented, not registered): Norway (credential-minted token + restricted agreement), Sweden (Basic/OAuth + Geotorget entitlement, COG-only), Latvia (401 / blank export), Ireland (MapGenie login), UK (commercial key; NI coast only), Andorra (OGC host dead), Monaco (no public service), Serbia (hosts unreachable), Bosnia (Cloudflare 403), Romania (DNS down after ransomware).

Registered bounds (MapLibre `[west, south, east, north]`):

- CH `[5.95, 45.82, 10.49, 47.81]` · NL `[3.36, 50.75, 7.23, 53.55]` · FR `[-5.14, 41.33, 9.56, 51.09]` · AT `[9.53, 46.37, 17.16, 49.02]`
- ES `[-9.5, 35.9, 4.5, 43.9]` · PT `[-10.19, 36.76, -5.71, 42.28]` · BE `[2.51, 49.5, 6.41, 51.51]` · LU `[5.73, 49.45, 6.53, 50.18]`
- PL `[14.12, 49.0, 24.15, 54.84]` · CZ `[12.09, 48.55, 18.86, 51.06]` · SI `[13.38, 45.42, 16.61, 46.88]` · HU `[16.11, 45.74, 22.9, 48.58]`
- EE `[21.76, 57.51, 28.21, 59.68]` · DK `[8.07, 54.56, 15.16, 57.75]`
- DE-NRW `[5.86, 50.32, 9.47, 53.68]` · DE-BY `[8.98, 47.27, 13.84, 50.57]` · DE-SN `[11.87, 50.17, 15.04, 51.69]`
- FI `[19.51, 59.81, 31.59, 70.09]` · IS `[-23.28, 63.9, -13.18, 66.53]` · LT `[20.0, 53.0, 26.0, 56.0]` · LI `[9.47, 47.05, 9.64, 47.27]`
- IT `[6.6, 35.5, 18.6, 47.1]` · IT-Lazio `[11.42, 40.74, 14.04, 42.8]` · GR `[19.0, 34.8, 29.7, 41.8]` · MT `[14.18, 35.78, 14.58, 36.09]`
- CY `[32.26, 34.55, 34.6, 35.7]` · SK-BA `[16.9, 48.0, 17.3, 48.3]` · HR `[13.0, 42.3, 19.5, 46.6]`

### Decision 4: Correct native max zoom per source; do not over-zoom

The global EOx source's `maxzoom` is set to 14 — its data's native resolution (~9.5 m/px at z14, i.e. the Sentinel-2 10 m floor). EOx serves tiles as far as z18, but those are upsampled from the same 10 m source, so capping at z14 saves bandwidth without losing detail; MapLibre over-zooms from there. Regional sources use their provider's native maxima (or, for WMS sources that have no pyramid, a practical detail limit): CH 20, NL 21, FR 19, AT 20, ES 19, PT 19, BE 19, LU 20, PL 19, CZ 18, SI 19, HU 18, EE 18, DK 20, DE 19. MapLibre over-zooms beyond `maxzoom` by scaling the last available tile, so detail looks correct up to the true limit and only degrades past it.

**Rationale:** This is the immediate, provider-independent fix for the reported blur and is included in this change.

**Risk:** Exact native maxima differ per provider and per country; values are verified against each provider's GetCapabilities/tile matrix rather than assumed.

### Decision 5: Layer order — global, then NAIP, then regional orthos, then labels

Order in `style.layers` is: `satellite-global` base, `satellite-naip`, each regional provider layer in registry order, then the existing vector label layers. Where bounds overlap (e.g. Spain's bbox encloses Portugal's), the later registry entry draws on top; narrower providers are listed after the wider ones they sit inside so the narrower provider wins.

**Rationale:** Preserves current US behaviour (NAIP still above global) and keeps all imagery under the labels so road/place names stay readable.

### Decision 6: Attribution is source-driven

Each raster source keeps its provider's required attribution string. MapLibre surface attribution for currently visible sources, so no aggregation code is needed.

**Verification:** After wiring, confirm the on-map attribution includes the provider string when its country is visible, and that the exact wording matches each provider's terms (legal requirement). Wording per provider is pinned in the tasks.

### Decision 7: Registry is a typed constant, not per-country code

A single `REGIONAL_ORTHOPHOTO_SOURCES: RegionalOrthophotoSource[]` in a new `src/constants/orthophotoSources.ts` drives source/layer generation in `satelliteStyle.ts`.

**Rationale:** Adding a country later is a one-object edit, and the shape is unit-testable without rendering a map. Matches the registry pattern already used for transit endpoints.

```ts
interface RegionalOrthophotoSource {
  id: string; // stable source/layer id, e.g. 'ortho-ch'
  label: string; // human label for diagnostics
  tiles: string[]; // MapLibre template(s): {z}/{x}/{y} or {bbox-epsg-3857}
  tileSize: 256;
  scheme?: 'xyz' | 'tms'; // default 'xyz'
  maxzoom: number; // provider native max zoom
  attribution: string;
  bounds: [number, number, number, number]; // [west, south, east, north]
  auth?: Array<{ name: string; envVar: string }>; // free-key query params
}
```

## Risks / Trade-offs

- **Endpoint drift / ToS change.** PDOK and basemap.at have changed URLs before. Mitigation: keep each provider isolated in the registry so a broken provider is a one-line removal, and note the licence per entry.
- **Keyless access is not permanent.** Norway and Finland already moved their open ortho tiles behind tokens/keys, and Kartverket is retiring its open WMTS. Any registered provider could do the same. Mitigation: providers are isolated in the registry (one-object removal), and both excluded providers can be re-added if a keyless endpoint returns.
- **Cross-border overdraw.** National bounds are approximate and may include a fringe of neighbouring territory where tiles 404 and fall through to the global base. Acceptable; bounds can be tightened per provider.
- **Deep-zoom blur remains.** Providers' native max is ~17–19; beyond that MapLibre over-zooms. This is inherent to open data and strictly better than today.
- **Attribution wording.** Getting it wrong is a licence breach. Mitigation: pin exact wording from each provider's terms as an explicit task and assert it in tests.
- **Licence confidence varies.** Several registered providers publish free-to-use government data without a formal open licence (Hungary, Czechia, Croatia, Italy, Greece) and three are explicitly unverified or restricted — Lithuania (no stated licence), Malta (unverified), Bratislava (unverified), Liechtenstein (non-commercial only). They are labelled in the registry/table; re-audit before any commercial release.
- **WMS performance.** WMS/`{bbox-epsg-3857}` sources are server-rendered per tile and uncached, unlike tiled providers; they are slower and heavier. Acceptable as an overlay at human zoom levels, and bounded so they only load in-country.
- **HTTP-only endpoints.** Italy (national PCN) and Greece serve plain HTTP, which iOS App Transport Security blocks, so they load on Android but not iOS. They are registered with clear labels; an ATS exception or an HTTPS proxy would be needed to enable them on iOS.
