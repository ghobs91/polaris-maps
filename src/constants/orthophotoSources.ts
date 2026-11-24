/**
 * Open national/regional orthophoto tile sources.
 *
 * Each entry is a national/regional aerial orthophoto service that is
 * published as open data (or free-to-use government data) and is layered
 * above the global EOx Sentinel-2 base in the satellite map style. Every
 * entry is bounded to its coverage, so tiles are only fetched where the
 * provider actually has imagery.
 *
 * The bulk of the registry is European, plus US state ortho services (which
 * exist because the only nationwide z17+ layer, the USGS NAIP on-demand
 * ImageServer, renders a novel tile in 20–90 s — see `satellite-naip-hires` in
 * `satelliteStyle.ts`).
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
    // IGN PNOA serves the Iberian peninsula, so its rectangular bounds include
    // Portugal; the out-of-country tiles come back as an opaque no-data fill
    // (verified) which would otherwise mask the finer PT layer beneath under
    // resolution-ordering. FORMAT=image/png&TRANSPARENT=TRUE returns a real
    // alpha tile (verified), so Spain falls through to Portugal.
    transparentBlank: true,
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
  // ── United States ────────────────────────────────────────────────────
  // Nationwide z17+ detail comes from the USGS NAIP ImageServer, which renders
  // each novel tile on demand (measured 20–90 s cold, including 504s under
  // load; an already-rendered bbox answers in ~70 ms). Until it lands, the map
  // shows the z16 cache overzoomed at 2.4 m/px — the blurry squares. State
  // ortho services render an order of magnitude faster, so they take over
  // inside their bounds.
  // NYS publishes one flight per year and each county is mosaicked into the
  // year it was flown, so no single service covers the state: measured at z17,
  // the 2023 flight has no data over Queens/Syracuse/Albany/Buffalo, the 2022
  // flight covers Queens and Syracuse, the 2021 flight covers Buffalo and
  // Albany, and `wms/Latest` (0.5 m) covers everything but is slower. Stacking
  // them means each county is answered by whichever flight was flown there,
  // all of them cached and in the 80–300 ms range instead of the USGS 20–90 s.
  {
    id: 'ortho-us-ny-latest',
    label: 'New York State — latest statewide orthoimagery by county (0.5 m)',
    // Uncached export: the fallback for counties whose newest flight is not one
    // of the 2021/2022/2023 services below.
    tiles: [
      'https://orthos.its.ny.gov/arcgis/rest/services/wms/Latest/MapServer/export' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256' +
        '&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    maxzoom: 17,
    minzoom: 12,
    resolutionM: 0.5,
    acquiredAt: '2023-01-01',
    attribution: 'NYS ITS Geospatial Services',
    bounds: [-79.77, 40.48, -71.75, 45.02],
  },
  {
    id: 'ortho-us-ny-2021',
    label: 'New York State — NYS 2021 orthoimagery (1 ft, tiled)',
    // Cached MapServer, standard global LOD ladder 0–19 (0.2986 m at z19).
    // Measured z17/z18/z19 over Buffalo and Albany: 79–119 ms, 9–20 kB.
    tiles: ['https://orthos.its.ny.gov/arcgis/rest/services/wms/2021/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    transparentBlank: true,
    maxzoom: 19,
    minzoom: 12,
    resolutionM: 0.3,
    acquiredAt: '2021-06-01',
    attribution: 'NYS ITS Geospatial Services',
    bounds: [-79.77, 40.48, -71.75, 45.02],
  },
  {
    id: 'ortho-us-ny-2022',
    label: 'New York State — NYS 2022 orthoimagery (1 ft, tiled)',
    // Measured z17/z18/z19 over Queens and Syracuse: 85–132 ms, 12–19 kB.
    tiles: ['https://orthos.its.ny.gov/arcgis/rest/services/wms/2022/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    transparentBlank: true,
    maxzoom: 19,
    minzoom: 12,
    resolutionM: 0.3,
    acquiredAt: '2022-06-01',
    attribution: 'NYS ITS Geospatial Services',
    bounds: [-79.77, 40.48, -71.75, 45.02],
  },
  {
    id: 'ortho-us-ny',
    label: 'New York State — NYS 2023 orthoimagery (12 in)',
    // ArcGIS MapServer export renders a 256 px tile in ~0.2–0.3 s (verified),
    // vs 20–90 s for the USGS ImageServer tile at the same zoom.
    tiles: [
      'https://orthos.its.ny.gov/arcgis/rest/services/wms/2023/MapServer/export' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256' +
        '&format=jpg&f=image',
    ],
    tileSize: 256,
    // The state bbox also covers parts of NJ/PA/CT/MA/VT. Outside NY coverage
    // the service answers with an opaque white JPEG but a fully transparent
    // PNG (verified), so ask for transparency and let the layers beneath show.
    transparentBlank: true,
    // 12 in natural colour; LOD 19 is the deepest real level (0.298 m/px).
    maxzoom: 19,
    minzoom: 12,
    resolutionM: 0.3,
    acquiredAt: '2023-06-01',
    attribution: 'NYS ITS Geospatial Services / Westchester County GIS',
    bounds: [-79.77, 40.48, -71.75, 45.02],
  },
  // ── United States: state-run orthoimagery, generated ─────────────────
  // Produced by `scripts/probe-state-orthos.mjs` (AGOL sweep → extent/state
  // attribution → real 256 px tile probes, 3 sample points, ≤3 s each), then
  // visually verified on a contact sheet of live tiles. Regenerate with:
  //
  //   node scripts/probe-state-orthos.mjs --json /tmp/sweep.json
  //   node scripts/probe-state-orthos.mjs --finalize /tmp/sweep.json --emit /tmp/entries.ts
  //
  // Every service here answered a novel 256 px tile in well under a second, so
  // z17–19 imagery arrives instead of the 20–90 s USGS NAIP render. Cached
  // ArcGIS services use `{z}/{y}/{x}`; services whose cache uses a non-global
  // LOD ladder (no 256 px Web Mercator ladder, e.g. West Virginia) are asked
  // through `export` instead, so MapLibre never fetches the wrong place.
  //
  // 24 of 51 states had a usable statewide service at the time of the sweep.
  // The rest publish county mosaics only, require a token, or have no current
  // statewide layer (AL AK CO DC FL GA HI IL LA MN MO MS NE NH NM NV OK SD TN
  // TX UT VT WA WI WY) — those keep the USGS NAIP fallback.
  {
    id: 'ortho-us-ar',
    label: 'Arkansas — 2023 statewide imagery (9 in)',
    tiles: [
      'https://gis.arkansas.gov/arcgis/rest/services/ImageServices/IMAGERY_9IN_2023/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2023-01-01',
    attribution: 'Arkansas Imagery 2023 — gis.arkansas.gov',
    bounds: [-94.6, 33, -89.6, 36.5],
  },
  {
    id: 'ortho-us-az',
    label: 'Arizona — 2023 statewide imagery (NAIP)',
    tiles: [
      'https://azgeo.az.gov/arcgis/rest/services/imagery/NAIP2023/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 18,
    resolutionM: 0.3,
    acquiredAt: '2023-01-01',
    attribution: 'Arizona Imagery 2023 (NAIP) — azgeo.az.gov',
    bounds: [-114.8, 31.3088, -109, 37],
  },
  {
    id: 'ortho-us-ct',
    label: 'Connecticut — 2023 spring aerial imagery (3 in, tiled)',
    tiles: [
      'https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.08,
    acquiredAt: '2023-01-01',
    attribution: 'CT 2023 Spring Aerial Imagery (4-band, 3inch, tiled) — cteco.uconn.edu',
    bounds: [-73.7, 41, -71.8, 42.0598],
  },
  {
    id: 'ortho-us-de',
    label: 'Delaware — 2024 orthoimagery',
    tiles: [
      'https://imagery.firstmap.delaware.gov/imagery/rest/services/DE_Imagery/DE_Imagery_2024/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.15,
    acquiredAt: '2024-01-01',
    attribution: 'State of Delaware, Sanborn Map Company, Inc.',
    bounds: [-75.8, 38.4498, -75.04, 39.8439],
  },
  {
    id: 'ortho-us-ia',
    label: 'Iowa — 2016–2018 spring orthophotos',
    tiles: [
      'https://ortho.gis.iastate.edu/arcgis/rest/services/ortho/ortho_2016_2018_nc/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 18,
    resolutionM: 0.3,
    acquiredAt: '2018-01-01',
    attribution: 'Iowa - 2016- 2018 Spring Orthophotos — ortho.gis.iastate.edu',
    bounds: [-96.6, 40.4, -90.1289, 43.5],
  },
  {
    id: 'ortho-us-id',
    label: 'Idaho — Idaho aerial imagery collections (2018)',
    tiles: [
      'https://insideidaho.org/arcgis/rest/services/imagery/imagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.2,
    acquiredAt: '2018-01-01',
    attribution: 'University of Idaho Library',
    bounds: [-117.2, 42, -111, 49],
  },
  {
    id: 'ortho-us-in',
    label: 'Indiana — current orthoimagery',
    tiles: [
      'https://di-ingov.img.arcgis.com/arcgis/rest/services/DynamicWebMercator/Indiana_Current_Imagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.08,
    acquiredAt: '2023-01-01',
    attribution:
      'Access to Indiana Geographic Information Office Orthoimagery is governed by Creative Commons 0 (CC0)',
    bounds: [-88.1, 37.8, -84.8, 41.8],
  },
  {
    id: 'ortho-us-ks',
    label: 'Kansas — 2024 NG911 1ft Natural Color',
    tiles: [
      'https://dascservices.kansasgis.org/arcgis/rest/services/IMAGERY_STATEWIDE/NG911_2024_1ft_Natural_Color/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 18,
    resolutionM: 0.3,
    acquiredAt: '2024-01-01',
    attribution: '2024 NG911 1ft Natural Color — dascservices.kansasgis.org',
    bounds: [-102.0687, 37, -94.6, 40],
  },
  {
    id: 'ortho-us-ky',
    label: 'Kentucky — KyFromAbove Phase 3 statewide imagery (3 in)',
    tiles: [
      'https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_Imagery_Phase3_3IN_WGS84WM/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2025-01-01',
    attribution: 'KyFromAbove Phase3 Statewide Imagery (Tile Layer) — kygisserver.ky.gov',
    bounds: [-89.6, 36.5, -81.9, 39.1596],
  },
  {
    id: 'ortho-us-ma',
    label: 'Massachusetts — 2025 aerial imagery',
    tiles: [
      'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2025-01-01',
    attribution: 'Massachusetts 2025 Aerial Imagery (Tile Service) — tiles.arcgis.com',
    bounds: [-73.5, 41.2244, -69.9231, 42.8964],
  },
  {
    id: 'ortho-us-md',
    label: 'Maryland — six-inch imagery',
    tiles: [
      'https://mdgeodata.md.gov/imagery/rest/services/SixInch/SixInchImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.15,
    acquiredAt: '2018-01-01',
    attribution: 'MD iMAP',
    bounds: [-79.5, 37.9, -75.0314, 39.7],
  },
  {
    id: 'ortho-us-me',
    label: 'Maine — 2025 statewide orthoimagery (15–20 cm)',
    tiles: [
      'https://utility.arcgis.com/usrsvcs/servers/b3fb68fcd44e4a31b30f4758a6f00067/rest/services/vexcel_bluesky_wide_ov_rgb_maine/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.15,
    acquiredAt: '2025-01-01',
    attribution: 'Vexcel Imaging',
    bounds: [-71.094, 43, -66.9, 47.4734],
  },
  {
    id: 'ortho-us-mi',
    label: 'Michigan — MiSAIL statewide imagery',
    tiles: [
      'https://imagery.michigan.gov/server/rest/services/Michigan_imagery_public/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2024-01-01',
    attribution: 'MiSAIL: Michigan Imagery Public Service — imagery.michigan.gov',
    bounds: [-90.5, 41.7, -82.4, 48.3],
  },
  {
    id: 'ortho-us-mt',
    label: 'Montana — NAIP 2025 (Provisional)',
    tiles: [
      'https://gisservice.mt.gov/arcgis/rest/services/MSDI_Framework/msdi_naip2025_provisional_image_v1/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 18,
    resolutionM: 0.3,
    acquiredAt: '2025-01-01',
    attribution: 'Montana NAIP 2025 (Provisional) — gisservice.mt.gov',
    bounds: [-116.0844, 44.4, -104, 49],
  },
  {
    id: 'ortho-us-nc',
    label: 'North Carolina — latest orthoimagery (2023)',
    tiles: [
      'https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest_cached/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2023-01-01',
    attribution: 'NC Center for Geographic Information and Analysis',
    bounds: [-84.3, 33.814, -75.5, 36.6],
  },
  {
    id: 'ortho-us-nd',
    label: 'North Dakota — NDGISHUB basemap imagery',
    tiles: [
      'https://ndgishub.nd.gov/arcgis/rest/services/Basemap_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2022-01-01',
    attribution:
      'U.S. Department of Agriculture, Farm Production and Conservation Business Center, Geospatial Enterprise Operations',
    bounds: [-104.0489, 45.935, -96.6, 49],
  },
  {
    id: 'ortho-us-nj',
    label: 'New Jersey — 2020 natural colour orthoimagery',
    tiles: [
      'https://maps.nj.gov/arcgis/rest/services/Basemap/Orthos_Natural_2020_NJ_WM/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2020-01-01',
    attribution:
      'Project definition, funding requests, and data distribution by NJ Office of Information Technology, Office of GIS.Funding provided by: -NJ Department of Environ',
    bounds: [-75.5998, 38.9, -73.9, 41.3866],
  },
  {
    id: 'ortho-us-oh',
    label: 'Ohio — most current statewide aerial imagery (OSIP)',
    tiles: [
      'https://maps.ohio.gov/image/rest/services/osip_most_current_cache/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2025-01-01',
    attribution:
      "Ohio's Most Current Statewide Aerial Imagery - Optimized Performance (Cached) — maps.ohio.gov",
    bounds: [-84.8, 38.4, -80.5, 42],
  },
  {
    id: 'ortho-us-or',
    label: 'Oregon — OSIP 2024 orthoimagery',
    tiles: [
      'https://imagery.oregonexplorer.info/arcgis/rest/services/OSIP_2024/OSIP_2024_WM/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 18,
    resolutionM: 0.3,
    acquiredAt: '2024-01-01',
    attribution:
      'Oregon Statewide Imagery Program (OSIP) - Oregon Imagery FrameworkImplementation Team',
    bounds: [-124.6, 42, -116.5, 46.3],
  },
  {
    id: 'ortho-us-pa',
    label: 'Pennsylvania — 2021–2023 statewide imagery (PEMA)',
    tiles: [
      'https://imagery.pasda.psu.edu/arcgis/rest/services/PEMAImagery2021_2023cache/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2023-01-01',
    attribution: 'PEMA Imagery 2021-2023 — imagery.pasda.psu.edu',
    bounds: [-80.5, 39.7, -74.7, 42.2904],
  },
  {
    id: 'ortho-us-ri',
    label: 'Rhode Island — 2026 spring digital aerial photograph (3 in)',
    tiles: [
      'https://maps.edc.uri.edu/rigis/rest/services/IMG/RI_202603_RGB_3in_web/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.08,
    acquiredAt: '2026-01-01',
    attribution: '2026 Spring_Rhode Island Digital Aerial Photograph — maps.edc.uri.edu',
    bounds: [-71.8994, 41.1468, -71.1194, 42],
  },
  {
    id: 'ortho-us-sc',
    label: 'South Carolina — 2023 aerial imagery (true colour)',
    tiles: [
      'https://tiles.arcgis.com/tiles/RvqSyw3diI7dTKo5/arcgis/rest/services/SC_2023_RGB/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2023-01-01',
    attribution:
      'Imagery collected in 2023 by Kucera International. Imagery is managed by Adam DeMars, South Carolina State GIS Coordinator and hosted by Esri.',
    bounds: [-83.3717, 32.0294, -78.5206, 35.2],
  },
  {
    id: 'ortho-us-va',
    label: 'Virginia — VBMP 2026 true colour imagery',
    tiles: [
      'https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VBMP_Imagery/VBMP2026_WGS/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2026-01-01',
    attribution: 'Virginia Geographic Information Network (VGIN)',
    bounds: [-83.7, 36.5, -75.2, 39.5],
  },
  {
    id: 'ortho-us-wv',
    label: 'West Virginia — statewide aerial imagery',
    tiles: [
      'https://services.wvgis.wvu.edu/arcgis/rest/services/Imagery_BaseMaps_EarthCover/wv_imagery_WVGISTC_leaf_off_mosaic/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    ],
    tileSize: 256,
    transparentBlank: true,
    minzoom: 13,
    maxzoom: 17,
    resolutionM: 0.5,
    acquiredAt: '2019-01-01',
    attribution: 'WV Aerial Imagery — services.wvgis.wvu.edu',
    bounds: [-82.6, 37.2, -77.7, 40.6],
  },
];

function acquiredTime(source: RegionalOrthophotoSource): number {
  const parsed = Date.parse(source.acquiredAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** True when two `[west, south, east, north]` boxes overlap. */
function boundsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Order the raster providers for the layer stack, coarsest first so the finest
 * provider that has pixels for an area draws on top (later layers draw above
 * earlier ones).
 *
 * MapLibre Native cannot switch sources per tile, so "highest resolution wins"
 * is expressed as layer stacking plus no-data fall-through: a provider only
 * masks the ones beneath it where it has imagery. That only holds for providers
 * whose out-of-coverage tiles fall through — `transparentBlank` (a transparent
 * PNG). A provider that paints an opaque no-data tile (white, black or a fill)
 * would mask a neighbour that has real imagery there, so it is never promoted.
 * Concretely, a fall-through provider is moved just above every coarser
 * provider it overlaps; every other provider keeps the curated registry order
 * (wider providers before the narrower ones they enclose), which was tuned to
 * those opaque tiles. Recency breaks exact-resolution ties (the newer provider
 * ends up higher). This is a no-op unless a provider is a verified fall-through.
 */
export function orderProvidersForStacking(
  providers: readonly RegionalOrthophotoSource[],
): RegionalOrthophotoSource[] {
  const curatedIndex = new Map(providers.map((source, index) => [source.id, index] as const));
  const stackRank = new Map(curatedIndex);

  // Coarsest first, so when a fall-through provider is ranked every provider it
  // can be promoted above has already reached its final rank.
  const coarsestFirst = [...providers].sort(
    (a, b) =>
      b.resolutionM - a.resolutionM ||
      acquiredTime(a) - acquiredTime(b) ||
      a.id.localeCompare(b.id),
  );
  for (const provider of coarsestFirst) {
    if (provider.transparentBlank !== true) continue;
    let rank = stackRank.get(provider.id) as number;
    for (const other of providers) {
      if (
        other !== provider &&
        other.resolutionM > provider.resolutionM &&
        boundsOverlap(provider.bounds, other.bounds)
      ) {
        rank = Math.max(rank, (stackRank.get(other.id) as number) + 1);
      }
    }
    stackRank.set(provider.id, rank);
  }

  return [...providers].sort(
    (a, b) =>
      (stackRank.get(a.id) as number) - (stackRank.get(b.id) as number) ||
      (curatedIndex.get(a.id) as number) - (curatedIndex.get(b.id) as number),
  );
}
