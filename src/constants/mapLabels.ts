/**
 * Shared OpenFreeMap vector label overlay.
 *
 * Both the satellite hybrid (raster imagery) and the terrain hybrid (topo
 * raster) draw their place/road/water labels from the same OpenMapTiles vector
 * source. The styling is tuned for imagery backgrounds — white text with dark
 * halos — so it stays legible over both aerial and topographic rasters.
 *
 * Labels carry the local `name` plus per-language `name:<lang>` fields;
 * `applyLabelLanguage` rewrites them into the user's language at resolve time,
 * which is why both styles share this single definition.
 */

export const OPENMAPTILES_SOURCE = {
  type: 'vector' as const,
  url: 'https://tiles.openfreemap.org/planet',
};

export const MAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Road, place, and water label layers, drawn in this order. */
export const LABEL_LAYERS: Record<string, unknown>[] = [
  // ───────────────────── Road Labels ─────────────────────
  {
    id: 'road-label-primary',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
    minzoom: 10,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13, 18, 16],
      'symbol-placement': 'line',
      'text-rotation-alignment': 'map',
      'text-max-angle': 30,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.75)',
      'text-halo-width': 2,
    },
  },
  {
    id: 'road-label-secondary',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    filter: ['==', 'class', 'secondary'],
    minzoom: 12,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 12, 18, 14],
      'symbol-placement': 'line',
      'text-rotation-alignment': 'map',
      'text-max-angle': 30,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1.8,
    },
  },
  {
    id: 'road-label-minor',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    filter: ['in', 'class', 'minor', 'tertiary', 'service'],
    minzoom: 14,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
      'symbol-placement': 'line',
      'text-rotation-alignment': 'map',
      'text-max-angle': 30,
    },
    paint: {
      'text-color': '#EEEEEE',
      'text-halo-color': 'rgba(0,0,0,0.65)',
      'text-halo-width': 1.5,
    },
  },

  // ───────────────────── Place Labels ─────────────────────
  {
    id: 'place-country',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['==', 'class', 'country'],
    minzoom: 2,
    maxzoom: 8,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.1,
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.8)',
      'text-halo-width': 2.5,
    },
  },
  {
    id: 'place-state',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['==', 'class', 'state'],
    minzoom: 4,
    maxzoom: 10,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 12],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.1,
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#EEEEEE',
      'text-halo-color': 'rgba(0,0,0,0.75)',
      'text-halo-width': 2,
    },
  },
  {
    id: 'place-city',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['==', 'class', 'city'],
    minzoom: 4,
    maxzoom: 14,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14, 12, 18],
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.8)',
      'text-halo-width': 2.5,
    },
  },
  {
    id: 'place-town',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['==', 'class', 'town'],
    minzoom: 8,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 14, 16, 17],
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.75)',
      'text-halo-width': 2,
    },
  },
  {
    id: 'place-village',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['in', 'class', 'village', 'hamlet'],
    minzoom: 10,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12, 18, 15],
      'text-max-width': 7,
    },
    paint: {
      'text-color': '#EEEEEE',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1.5,
    },
  },

  // ───────────────────── Water Labels ─────────────────────
  {
    id: 'water-name-ocean',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'water_name',
    filter: ['==', 'class', 'ocean'],
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 12, 8, 16],
      'text-letter-spacing': 0.15,
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#8EBFFF',
      'text-halo-color': 'rgba(0,0,0,0.6)',
      'text-halo-width': 1.5,
    },
  },
  {
    id: 'water-name-other',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'water_name',
    filter: ['!in', 'class', 'ocean'],
    minzoom: 8,
    layout: {
      'text-field': '{name}',
      'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
      'text-max-width': 6,
    },
    paint: {
      'text-color': '#8EBFFF',
      'text-halo-color': 'rgba(0,0,0,0.55)',
      'text-halo-width': 1.2,
    },
  },
];
