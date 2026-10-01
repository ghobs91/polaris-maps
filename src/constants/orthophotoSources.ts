/**
 * Open European orthophoto tile sources.
 *
 * Each entry is a national/regional aerial orthophoto service that is
 * published as open data (or free-to-use government data) and is layered
 * above the global EOx Sentinel-2 base in the satellite map style. Every
 * entry is bounded to its coverage, so tiles are only fetched where the
 * provider actually has imagery.
 *
 * Sources are either tiled (XYZ/WMTS with `{z}/{x}/{y}`) or WMS/ArcGIS Map
 * endpoints expressed with MapLibre's `{bbox-epsg-3857}` placeholder.
 *
 * `resolutionM` (nominal ground sample distance) and `acquiredAt` (approximate
 * acquisition/version date) drive the satellite tile router's ranking. They are
 * approximate and documented per provider; recency for the global providers is
 * handled in `src/services/imagery/imagerySources.ts`.
 *
 * Providers that need a free account credential declare `auth`; their query
 * params are read from EXPO_PUBLIC_* env vars and the provider is omitted
 * entirely when those vars are unset, so no secret is committed.
 *
 * Providers that answer no-data / out-of-scale requests with a blank (white or
 * black) 200 image instead of a 404 declare `transparentBlank`, so the
 * satellite style asks them for a transparent PNG — an opaque blank tile would
 * otherwise mask the imagery beneath it. `minzoom` is set where a provider's
 * pyramid is blank below a given level, so those overview tiles are never
 * requested at all.
 */

/** A query parameter whose value is read from an environment variable. */
export interface RegionalOrthophotoAuthParam {
  /** Query parameter name appended to the tile URL, e.g. `username`. */
  name: string;
  /** Environment variable holding the value, e.g. `EXPO_PUBLIC_DK_...`. */
  envVar: string;
}

export interface RegionalOrthophotoSource {
  /** Stable source/layer id prefix, e.g. `ortho-ch`. */
  id: string;
  /** Human-readable label for diagnostics. */
  label: string;
  /** MapLibre raster URL template(s) with `{z}/{x}/{y}` or `{bbox-epsg-3857}`. */
  tiles: string[];
  tileSize: number;
  /** Tile Y axis direction; defaults to `xyz`. */
  scheme?: 'xyz' | 'tms';
  /**
   * Minimum zoom at which the source is useful; defaults to 0. Set above 0 for
   * providers whose pyramid only has data from a certain level, so the blank
   * overview tiles never mask the global base.
   */
  minzoom?: number;
  /** Native maximum zoom (or practical detail limit for WMS sources). */
  maxzoom: number;
  /** Nominal ground sample distance in metres/pixel (ranking primary key). */
  resolutionM: number;
  /** Approximate acquisition/version date, ISO `YYYY-MM-DD` (tie-breaker). */
  acquiredAt: string;
  /** Attribution required by the provider's licence. */
  attribution: string;
  /** Coverage extent as `[west, south, east, north]`. */
  bounds: [number, number, number, number];
  /**
   * Request a transparent PNG instead of an opaque JPEG. Set for WMS/Map/ArcGIS
   * providers that paint blank (white or black) no-data tiles rather than
   * 404ing: an opaque blank tile masks the imagery beneath, while a transparent
   * one lets the global base show through. Ignored when the URL has no known
   * image-format parameter, or when the server ignores the request.
   */
  transparentBlank?: boolean;
  /** Free-key query params; provider is skipped when any env var is unset. */
  auth?: RegionalOrthophotoAuthParam[];
}

export const REGIONAL_ORTHOPHOTO_SOURCES: RegionalOrthophotoSource[] = [
  {
    id: 'ortho-ch',
    label: 'Switzerland — swisstopo SWISSIMAGE (10 cm)',
    tiles: [
      'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: 256,
    maxzoom: 20,
    resolutionM: 0.1,
    acquiredAt: '2023-06-01',
    attribution: '© swisstopo',
    bounds: [5.95, 45.82, 10.49, 47.81],
    // swisstopo's tiles are opaque white outside Switzerland, and MapLibre
    // renders a whole tile for any tile that merely intersects a source's
    // bounds — so at low zoom this painted a large white block across the
    // neighbours. Only request it once tiles are dominated by its coverage.
    minzoom: 10,
  },
  {
    id: 'ortho-nl',
    label: 'Netherlands — PDOK Luchtfoto RGB (5–8 cm)',
    tiles: [
      'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: 256,
    maxzoom: 21,
    resolutionM: 0.05,
    acquiredAt: '2026-04-01',
    attribution: '© Beeldmateriaal.nl / PDOK',
    bounds: [3.36, 50.75, 7.23, 53.55],
    // PDOK returns opaque white outside NL; see ortho-ch for why this is a
    // minzoom rather than a transparency fix.
    minzoom: 10,
  },
  {
    id: 'ortho-fr',
    label: 'France — IGN ORTHOIMAGERY.ORTHOPHOTOS (20 cm)',
    tiles: [
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg' +
        '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2024-06-01',
    attribution: '© IGN',
    bounds: [-5.14, 41.33, 9.56, 51.09],
  },
  {
    id: 'ortho-at',
    label: 'Austria — basemap.at orthofoto (30 cm)',
    tiles: ['https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg'],
    tileSize: 256,
    maxzoom: 20,
    resolutionM: 0.3,
    acquiredAt: '2024-06-01',
    attribution: 'Datenquelle: basemap.at',
    bounds: [9.53, 46.37, 17.16, 49.02],
    // basemap.at returns flat white outside Austria; see ortho-ch.
    minzoom: 10,
  },
  {
    id: 'ortho-es',
    label: 'Spain — IGN PNOA (25–50 cm)',
    tiles: [
      'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible' +
        '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.25,
    acquiredAt: '2024-06-01',
    attribution: '© IGN/CNIG — PNOA',
    bounds: [-9.5, 35.9, 4.5, 43.9],
  },
  {
    id: 'ortho-pt',
    label: 'Portugal — DGT OrtoSat (30 cm)',
    tiles: [
      'https://ogcapi.dgterritorio.gov.pt/collections/ortos-rgb/map?f=png' +
        '&bbox={bbox-epsg-3857}&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3857' +
        '&width=256&height=256',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.3,
    acquiredAt: '2023-06-01',
    attribution: '© DGT',
    bounds: [-10.19, 36.76, -5.71, 42.28],
  },
  {
    id: 'ortho-be',
    label: 'Belgium — NGI/IGN ortho (12.5–25 cm)',
    tiles: [
      'https://wmts.ngi.be/inspire/ortho/1.0.0/orthoimage_coverage/default/3857/latest/{z}/{y}/{x}.png',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.125,
    acquiredAt: '2024-06-01',
    attribution: '© NGI/IGN',
    bounds: [2.51, 49.5, 6.41, 51.51],
    minzoom: 7,
  },
  {
    id: 'ortho-lu',
    label: 'Luxembourg — ACT orthophoto (10 cm)',
    tiles: [
      'https://wms.inspire.geoportail.lu/geoserver/wms?service=WMS&version=1.3.0' +
        '&request=GetMap&layers=oi:OI_OrthoimageCoverage_RGB_2025_summer&styles=' +
        '&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 20,
    resolutionM: 0.1,
    acquiredAt: '2025-06-01',
    attribution: '© ACT Luxembourg (CC0)',
    bounds: [5.73, 49.45, 6.53, 50.18],
    // Luxembourg's tile pyramid only has imagery from z9.
    minzoom: 9,
    transparentBlank: true,
  },
  {
    id: 'ortho-pl',
    label: 'Poland — GUGiK Ortofotomapa (25 cm)',
    tiles: [
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution' +
        '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default' +
        '&FORMAT=image/jpeg&tileMatrixSet=EPSG:3857&tileMatrix=EPSG:3857:{z}' +
        '&tileRow={y}&tileCol={x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.25,
    acquiredAt: '2024-06-01',
    attribution: '© GUGiK (geoportal.gov.pl)',
    bounds: [14.12, 49.0, 24.15, 54.84],
    // The Polish WMTS returns HTTP 500s and non-image bodies at low/mid zoom.
    minzoom: 10,
  },
  {
    id: 'ortho-cz',
    label: 'Czechia — ČÚZK ORTOFOTO (20 cm)',
    tiles: [
      'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/WMTS/tile' +
        '/1.0.0/ORTOFOTO_WM/default/GoogleMapsCompatible/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.2,
    acquiredAt: '2024-06-01',
    attribution: '© ČÚZK',
    bounds: [12.09, 48.55, 18.86, 51.06],
    minzoom: 6,
  },
  {
    id: 'ortho-si',
    label: 'Slovenia — GURS DOF (25 cm)',
    tiles: [
      'https://ipi.eprostor.gov.si/wms-si-gurs-dts/wms?SERVICE=WMS&VERSION=1.1.1' +
        '&REQUEST=GetMap&LAYERS=SI.GURS.ZPDZ:DOF025_3857&STYLES=&SRS=EPSG:3857' +
        '&FORMAT=image/jpeg&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.25,
    acquiredAt: '2024-06-01',
    attribution: '© GURS',
    bounds: [13.38, 45.42, 16.61, 46.88],
    minzoom: 7,
    transparentBlank: true,
  },
  {
    id: 'ortho-hu',
    label: 'Hungary — Lechner orthoimagery (≈40–50 cm)',
    tiles: [
      'https://inspire.lechnerkozpont.hu/geoserver/OI.2023/wms?SERVICE=WMS' +
        '&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OrthoimageCoverage2023&STYLES=' +
        '&CRS=EPSG:3857&FORMAT=image/jpeg&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.45,
    acquiredAt: '2023-06-01',
    attribution: '© Lechner Tudásközpont',
    bounds: [16.11, 45.74, 22.9, 48.58],
    minzoom: 6,
    transparentBlank: true,
  },
  {
    id: 'ortho-ee',
    label: 'Estonia — Maa- ja Ruumiamet ortofoto (≈60 cm)',
    tiles: [
      'https://tiles.maaamet.ee/tm/wmts?service=WMTS&request=GetTile&version=1.0.0' +
        '&layer=foto&style=default&format=image/jpeg&tilematrixset=GMC' +
        '&TileMatrix={z}&TileRow={y}&TileCol={x}',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.6,
    acquiredAt: '2023-06-01',
    attribution: '© Maa- ja Ruumiamet',
    bounds: [21.76, 57.51, 28.21, 59.68],
    minzoom: 6,
  },
  {
    id: 'ortho-dk',
    label: 'Denmark — Datafordeler GeoDanmark ortofoto (10–20 cm)',
    tiles: [
      'https://services.datafordeler.dk/GeoDanmarkOrto/orto_foraar_webm/1.0.0/WMTS' +
        '//orto_foraar_webm/default/DFD_GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    maxzoom: 20,
    resolutionM: 0.1,
    acquiredAt: '2024-06-01',
    attribution: '© GeoDanmark / Klimadatastyrelsen',
    bounds: [8.07, 54.56, 15.16, 57.75],
    auth: [
      { name: 'username', envVar: 'EXPO_PUBLIC_DK_DATAFORSYNING_USER' },
      { name: 'password', envVar: 'EXPO_PUBLIC_DK_DATAFORSYNING_PASSWORD' },
    ],
  },
  {
    id: 'ortho-de-nw',
    label: 'Germany (NRW) — Geobasis NRW DOP (20 cm)',
    tiles: [
      'https://www.wms.nrw.de/geobasis/wms_nw_dop?service=WMS&version=1.3.0' +
        '&request=GetMap&layers=nw_dop_rgb&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}' +
        '&width=256&height=256&format=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2024-06-01',
    attribution: '© Geobasis NRW',
    bounds: [5.86, 50.32, 9.47, 53.68],
    minzoom: 6,
    transparentBlank: true,
  },
  {
    id: 'ortho-de-by',
    label: 'Germany (Bavaria) — DOP20 (20 cm)',
    tiles: [
      'https://geoservices.bayern.de/od/wms/dop/v1/dop20?service=WMS&version=1.3.0' +
        '&request=GetMap&layers=by_dop20c&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}' +
        '&width=256&height=256&format=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2024-06-01',
    attribution: '© Bayerische Vermessungsverwaltung',
    bounds: [8.98, 47.27, 13.84, 50.57],
    minzoom: 7,
    transparentBlank: true,
  },
  {
    id: 'ortho-de-sn',
    label: 'Germany (Saxony) — GeoSN DOP20 (20 cm)',
    tiles: [
      'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest?service=WMS&version=1.3.0' +
        '&request=GetMap&layers=sn_dop_020&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}' +
        '&width=256&height=256&format=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2023-06-01',
    attribution: '© GeoSN',
    bounds: [11.87, 50.17, 15.04, 51.69],
    minzoom: 7,
    transparentBlank: true,
  },
  {
    id: 'ortho-fi',
    label: 'Finland — MML ortokuva (orthophoto)',
    tiles: [
      'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default' +
        '/WGS84_Pseudo-Mercator/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    maxzoom: 16,
    resolutionM: 0.5,
    acquiredAt: '2024-06-01',
    attribution: '© Maanmittauslaitos (NLS Finland)',
    bounds: [19.51, 59.81, 31.59, 70.09],
    auth: [{ name: 'api-key', envVar: 'EXPO_PUBLIC_FI_MML_API_KEY' }],
  },
  {
    id: 'ortho-is',
    label: 'Iceland — LMÍ loftmyndir (aerial mosaic)',
    tiles: [
      'https://gis.lmi.is/geoserver/wms?service=WMS&version=1.1.1&request=GetMap' +
        '&layers=loftmyndir:loftmyndir_hnitsettar&styles=&srs=EPSG:3857' +
        '&bbox={bbox-epsg-3857}&width=256&height=256&format=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2023-06-01',
    attribution: '© Landmælingar Íslands / Náttúrufræðistofnun',
    bounds: [-23.28, 63.9, -13.18, 66.53],
    minzoom: 5,
    // The single-resolution mosaic has no data above ~z8; the rest is white.
    transparentBlank: true,
  },
  {
    id: 'ortho-lt',
    label: 'Lithuania — RRT Ortofoto (licence unverified)',
    tiles: [
      'https://arcgis.rrt.lt/arcgis/rest/services/Ortofoto/MapServer/export' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2023-06-01',
    attribution: '© RRT (arcgis.rrt.lt)',
    bounds: [20.0, 53.0, 26.0, 56.0],
  },
  {
    id: 'ortho-li',
    label: 'Liechtenstein — swisstopo SwissImage via LLV (non-commercial)',
    tiles: [
      'https://service.geo.llv.li/service/wms?service=WMS&version=1.3.0&request=GetMap' +
        '&layers=li.atg.orthophoto2025&styles=&crs=EPSG:3857&format=image/jpeg' +
        '&width=256&height=256&bbox={bbox-epsg-3857}',
    ],
    tileSize: 256,
    maxzoom: 20,
    resolutionM: 0.1,
    acquiredAt: '2025-06-01',
    attribution: '© Amt für Tiefbau und Geoinformation (LLV), Liechtenstein',
    bounds: [9.47, 47.05, 9.64, 47.27],
    // Liechtenstein is tiny; below z9 the request bbox spans far too much.
    minzoom: 9,
    transparentBlank: true,
  },
  {
    id: 'ortho-it',
    label: 'Italy — PCN national orthophoto 2012 (50 cm)',
    // The national PCN service is a MapServer CGI: it requires the `map` query
    // parameter naming the mapfile, and exposes the orthoimage as two
    // UTM-zone layers (32 = west/central Italy, 33 = east). Both are requested
    // together so one source covers the whole country. It is served over HTTPS,
    // so unlike the (now-dead) Greek proxy it is usable on iOS. A blank tile is
    // painted below the layer group's scale threshold, hence `minzoom`.
    tiles: [
      'https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/ortofoto_colore_12.map' +
        '&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
        '&LAYERS=OI.ORTOIMMAGINI.2012.32,OI.ORTOIMMAGINI.2012.33&STYLES=' +
        '&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2012-06-01',
    attribution: '© PCN (Portale Cartografico Nazionale) — Ortofoto a colori 2012',
    bounds: [6.6, 35.5, 18.6, 47.1],
    // Imagery only appears from z11; below that the layer group returns a blank
    // tile, which would mask the global base.
    minzoom: 11,
    transparentBlank: true,
  },
  {
    id: 'ortho-it-lazio',
    label: 'Italy (Lazio) — AGEA 2023 orthophoto (20 cm)',
    tiles: [
      'https://geoportale.regione.lazio.it/geoserver/ows?SERVICE=WMS&VERSION=1.3.0' +
        '&REQUEST=GetMap&LAYERS=geonode:2023_AGEA_25833_COG&STYLES=&CRS=EPSG:3857' +
        '&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2023-06-01',
    attribution: '© Regione Lazio (CC BY 4.0)',
    bounds: [11.42, 40.74, 14.04, 42.8],
    // The AGEA layer renders near-black at low zoom and a noisy/pixelated
    // mosaic between roughly z11–14 (its PNG output is also opaque black), so
    // keep the JPEG and only request it from z15, where the imagery is clean.
    minzoom: 15,
  },
  {
    id: 'ortho-mt',
    label: 'Malta — ERAPortal orthophoto 2012 (licence unverified)',
    tiles: [
      'https://eraportal.org.mt/arcgis/rest/services/Orthophoto/Orthophoto_External' +
        '/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857' +
        '&size=256,256&format=jpg&f=image',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.3,
    acquiredAt: '2012-06-01',
    attribution: '© Environment & Resources Authority, Malta',
    bounds: [14.18, 35.78, 14.58, 36.09],
    // Malta is tiny; only the deeper tiles carry real imagery.
    minzoom: 10,
    transparentBlank: true,
  },
  {
    id: 'ortho-cy',
    label: 'Cyprus — DLS orthophoto 2014 (10 cm)',
    tiles: [
      'https://eservices.dls.moi.gov.cy/arcgis/services/BASEMAPS/Imagery_Orthophoto_2014_10cm' +
        '/MapServer/WmsServer?service=WMS&version=1.3.0&request=GetMap&layers=0' +
        '&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/jpeg&styles=',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.1,
    acquiredAt: '2014-06-01',
    attribution: '© Department of Lands and Surveys, Cyprus',
    bounds: [32.26, 34.55, 34.6, 35.7],
    minzoom: 8,
    transparentBlank: true,
  },
  {
    id: 'ortho-sk-ba',
    label: 'Slovakia (Bratislava) — city orthophoto 2021',
    tiles: [
      'https://geoportal.bratislava.sk/hSite/rest/services/Hosted/Ortofoto_2021' +
        '/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.15,
    acquiredAt: '2021-06-01',
    attribution: '© City of Bratislava',
    bounds: [16.9, 48.0, 17.3, 48.3],
  },
  {
    id: 'ortho-hr',
    label: 'Croatia — DGU DOF ortofoto',
    tiles: [
      'https://geoportal.dgu.hr/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
        '&LAYERS=DOF&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}' +
        '&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg',
    ],
    tileSize: 256,
    maxzoom: 19,
    resolutionM: 0.3,
    acquiredAt: '2011-06-01',
    attribution: '© Državna geodetska uprava (DGU)',
    bounds: [13.0, 42.3, 19.5, 46.6],
    minzoom: 7,
    transparentBlank: true,
  },
  {
    id: 'ortho-nz',
    label: 'New Zealand — LINZ Aerial Imagery (5 cm urban)',
    tiles: ['https://basemaps.linz.govt.nz/v1/tiles/aerial/3857/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 20,
    resolutionM: 0.05,
    acquiredAt: '2024-06-01',
    attribution: '© LINZ (CC BY 4.0)',
    bounds: [166.3, -47.5, 178.7, -34.1],
    // Standard access works keyless but is rate-limited; a free Developer key
    // (or the 90-day dynamic key) can be supplied to raise limits.
    auth: [{ name: 'api', envVar: 'EXPO_PUBLIC_LINZ_API_KEY' }],
  },
  // ── Middle East ──────────────────────────────────────────────────────
  // Open high-resolution coverage here is sparse: most national geoportals are
  // token-gated (UAE) or publish cleartext-only services (Turkey, ATS-blocked
  // on iOS). These two were live-verified over HTTPS.
  {
    id: 'ortho-qa',
    label: 'Qatar — CGIS national satellite mosaic 2025',
    tiles: [
      'https://services.gisqatar.org.qa/server/rest/services/Imagery/QatarSatelitte_WGS84/MapServer/export' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256' +
        '&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.5,
    acquiredAt: '2025-04-01',
    attribution: '© Qatar Centre for GIS (CGIS)',
    bounds: [50.55, 24.4, 51.95, 26.25],
    // Returns transparent no-data, but skip continent-scale requests anyway.
    minzoom: 9,
  },
  {
    id: 'ortho-il-telaviv',
    label: 'Israel — Tel Aviv-Yafo municipal orthophoto 2025',
    tiles: [
      'https://gisn.tel-aviv.gov.il/arcgis/rest/services/WM/IView2Ortho2025WM/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.1,
    acquiredAt: '2025-06-01',
    attribution: '© Tel Aviv-Yafo Municipality',
    bounds: [34.72, 32.02, 34.87, 32.16],
    minzoom: 12,
  },
  {
    id: 'ortho-om',
    label: 'Oman — National Survey satellite mosaic 2018',
    tiles: [
      'https://geoportal.mm.gov.om/server/rest/services/SatelliteImages2018_pro_MIL1/MapServer/export' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256' +
        '&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    maxzoom: 18,
    resolutionM: 0.5,
    acquiredAt: '2018-06-01',
    attribution: '© Ministry of Housing and Urban Planning (Oman)',
    bounds: [52.0, 16.6, 60.0, 26.5],
    // Transparent no-data, but skip continent-scale dynamic requests.
    minzoom: 9,
  },
];
