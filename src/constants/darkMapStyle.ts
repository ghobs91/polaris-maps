/**
 * Custom MapLibre dark-mode style inspired by Apple Maps' dark appearance.
 *
 * Characteristics:
 *   - Warm neutral charcoal land (#2B2B2F) — brighter than a near-black dark mode
 *   - Deep navy water (#16293A) with clear contrast from land
 *   - Amber/gold highways (trunk/motorway) — Apple Maps signature
 *   - Neutral gray local roads that recede into the background
 *   - Richer green parks and grass, closer to Apple Maps at night
 *   - Bright white labels with dark halos for readability
 *
 * Uses OpenFreeMap vector tiles (OpenMapTiles schema). No API key required.
 */

const style = {
  version: 8 as const,
  name: 'Polaris Dark',
  sources: {
    openmaptiles: {
      type: 'vector' as const,
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    // ───────────────────── Background ─────────────────────
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#2B2B2F' },
    },

    // ───────────────────── Landcover ─────────────────────
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wood'],
      paint: { 'fill-color': '#44563C', 'fill-opacity': 0.5 },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'grass'],
      paint: { 'fill-color': '#566745', 'fill-opacity': 0.45 },
    },
    {
      id: 'landcover-farmland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'farmland'],
      paint: { 'fill-color': '#343438', 'fill-opacity': 0.28 },
    },
    {
      id: 'landcover-ice',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'ice'],
      paint: { 'fill-color': '#424247', 'fill-opacity': 0.45 },
    },
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'sand'],
      paint: { 'fill-color': '#3A342E', 'fill-opacity': 0.35 },
    },
    {
      id: 'landcover-wetland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wetland'],
      paint: { 'fill-color': '#2A3337', 'fill-opacity': 0.4 },
    },

    // ───────────────────── Landuse ─────────────────────
    {
      id: 'landuse-residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'residential'],
      paint: { 'fill-color': '#36363A', 'fill-opacity': 0.32 },
    },
    {
      id: 'landuse-commercial',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'commercial', 'retail'],
      paint: { 'fill-color': '#3A3A3E', 'fill-opacity': 0.32 },
    },
    {
      id: 'landuse-industrial',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'industrial'],
      paint: { 'fill-color': '#333338', 'fill-opacity': 0.3 },
    },
    {
      id: 'landuse-park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'park', 'garden', 'playground'],
      paint: { 'fill-color': '#3A7F61', 'fill-opacity': 0.56 },
    },
    {
      id: 'landuse-cemetery',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'cemetery'],
      paint: { 'fill-color': '#435243', 'fill-opacity': 0.36 },
    },
    {
      id: 'landuse-hospital',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'hospital'],
      paint: { 'fill-color': '#3D353D', 'fill-opacity': 0.3 },
    },
    {
      id: 'landuse-school',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'school'],
      paint: { 'fill-color': '#3B353D', 'fill-opacity': 0.3 },
    },
    {
      id: 'landuse-stadium',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'stadium', 'pitch'],
      paint: { 'fill-color': '#3E7358', 'fill-opacity': 0.44 },
    },

    // Park overlay (named parks from dedicated source layer)
    {
      id: 'park-fill',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': '#408564', 'fill-opacity': 0.54 },
    },

    // ───────────────────── Water ─────────────────────
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#16293A' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#16293A',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2, 18, 4],
      },
    },

    // ───────────────────── Building ─────────────────────
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': '#5B5861',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.58, 17, 0.78],
      },
    },

    // ───────────────────── Aeroway ─────────────────────
    {
      id: 'aeroway-runway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      filter: ['==', 'class', 'runway'],
      paint: {
        'line-color': '#57575C',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 6, 18, 20],
      },
    },
    {
      id: 'aeroway-taxiway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      filter: ['==', 'class', 'taxiway'],
      paint: {
        'line-color': '#4D4D52',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2, 18, 8],
      },
    },

    // ───────────────────── Transportation: Tunnels ─────────────────────
    {
      id: 'tunnel-service',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'tunnel'], ['in', 'class', 'service', 'track']],
      paint: {
        'line-color': '#4A4A4F',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 3],
        'line-dasharray': [3, 3],
      },
    },
    {
      id: 'tunnel-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'tunnel'], ['in', 'class', 'minor', 'tertiary']],
      paint: {
        'line-color': '#56565B',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 14, 1.5, 18, 6],
        'line-dasharray': [3, 3],
      },
    },
    {
      id: 'tunnel-secondary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'tunnel'], ['==', 'class', 'secondary']],
      paint: {
        'line-color': '#626267',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 2, 18, 8],
        'line-dasharray': [3, 3],
      },
    },
    {
      id: 'tunnel-primary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'tunnel'], ['==', 'class', 'primary']],
      paint: {
        'line-color': '#747479',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3, 18, 10],
        'line-dasharray': [3, 3],
      },
    },
    {
      id: 'tunnel-trunk',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'tunnel'], ['==', 'class', 'trunk']],
      paint: {
        'line-color': '#9B8A5E',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3, 18, 12],
        'line-dasharray': [3, 3],
      },
    },
    {
      id: 'tunnel-motorway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'tunnel'], ['==', 'class', 'motorway']],
      paint: {
        'line-color': '#AD9768',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 4, 18, 14],
        'line-dasharray': [3, 3],
      },
    },

    // ───────────────────── Transportation: Roads ─────────────────────
    // Casings (rendered first, below fills)
    {
      id: 'road-motorway-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'motorway']],
      minzoom: 5,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#202024',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 2.5, 14, 6, 18, 18],
      },
    },
    {
      id: 'road-trunk-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'trunk']],
      minzoom: 6,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#202024',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 2, 14, 5, 18, 16],
      },
    },
    {
      id: 'road-primary-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'primary']],
      minzoom: 7,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#232327',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 14, 4, 18, 13],
      },
    },
    {
      id: 'road-secondary-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'secondary']],
      minzoom: 9,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#232327',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 3, 18, 11],
      },
    },

    // Fills (on top of casings)
    {
      id: 'road-path',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['in', 'class', 'path', 'track']],
      minzoom: 14,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#57575C',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 2],
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'road-service',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'service']],
      minzoom: 13,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#57575C',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 16, 1.5, 18, 4],
      },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['in', 'class', 'minor', 'tertiary']],
      minzoom: 10,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#6B6B70',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 14, 1.5, 16, 4, 18, 8],
      },
    },
    {
      id: 'road-secondary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'secondary']],
      minzoom: 8,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7A7A7E',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 14, 2, 16, 4.5, 18, 9],
      },
    },
    {
      id: 'road-primary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'primary']],
      minzoom: 6,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#8A8A8E',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 1, 14, 3, 18, 11],
      },
    },
    {
      id: 'road-trunk',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'trunk']],
      minzoom: 5,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#B29C6C',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 10, 1.5, 14, 3.5, 18, 13],
      },
    },
    {
      id: 'road-motorway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!has', 'brunnel'], ['==', 'class', 'motorway']],
      minzoom: 4,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#C4AA73',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 1, 14, 4, 18, 16],
      },
    },
    {
      id: 'road-rail',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['==', 'class', 'rail'],
      minzoom: 10,
      paint: {
        'line-color': '#5B5B60',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 14, 1.2, 18, 3],
      },
    },
    {
      id: 'road-rail-dash',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['==', 'class', 'rail'],
      minzoom: 10,
      paint: {
        'line-color': '#3A3A3F',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 14, 1, 18, 2.5],
        'line-dasharray': [3, 4],
      },
    },

    // ───────────────────── Transportation: Bridges ─────────────────────
    {
      id: 'bridge-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: [
        'all',
        ['==', 'brunnel', 'bridge'],
        ['in', 'class', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#202024',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          1,
          14,
          ['match', ['get', 'class'], 'motorway', 7, 'trunk', 6, 'primary', 5, 'secondary', 4, 3],
          18,
          [
            'match',
            ['get', 'class'],
            'motorway',
            18,
            'trunk',
            16,
            'primary',
            14,
            'secondary',
            12,
            10,
          ],
        ],
      },
    },
    {
      id: 'bridge-fill',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: [
        'all',
        ['==', 'brunnel', 'bridge'],
        ['in', 'class', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'motorway',
          '#C4AA73',
          'trunk',
          '#B29C6C',
          'primary',
          '#8A8A8E',
          'secondary',
          '#7A7A7E',
          '#6B6B70',
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.5,
          14,
          ['match', ['get', 'class'], 'motorway', 5, 'trunk', 4, 'primary', 3.5, 'secondary', 3, 2],
          18,
          [
            'match',
            ['get', 'class'],
            'motorway',
            16,
            'trunk',
            14,
            'primary',
            12,
            'secondary',
            10,
            8,
          ],
        ],
      },
    },

    // ───────────────────── Boundaries ─────────────────────
    {
      id: 'admin-boundary-country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['<=', 'admin_level', 2],
      paint: {
        'line-color': '#76767B',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 1.5, 14, 2.5],
        'line-dasharray': [4, 2],
      },
    },
    {
      id: 'admin-boundary-state',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['>=', 'admin_level', 3], ['<=', 'admin_level', 4]],
      minzoom: 4,
      paint: {
        'line-color': '#66666B',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 10, 1, 14, 1.5],
        'line-dasharray': [4, 3],
      },
    },

    // ───────────────────── Labels: Water ─────────────────────
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
        'text-color': '#6CA6D4',
        'text-halo-color': '#16212D',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water-name-sea',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['==', 'class', 'sea'],
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 14],
        'text-letter-spacing': 0.1,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#6CA6D4',
        'text-halo-color': '#16212D',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'water-name-lake',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['!in', 'class', 'ocean', 'sea'],
      minzoom: 8,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#6CA6D4',
        'text-halo-color': '#16212D',
        'text-halo-width': 1,
      },
    },

    // ───────────────────── Labels: Roads ─────────────────────
    {
      id: 'road-label-primary',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
      minzoom: 10,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12, 18, 15],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#D8CBA4',
        'text-halo-color': '#2B2B2F',
        'text-halo-width': 1.5,
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
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 8.5, 16, 12, 18, 14],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#BEBEC2',
        'text-halo-color': '#2B2B2F',
        'text-halo-width': 1.5,
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
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 8, 18, 12],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#AEAEB2',
        'text-halo-color': '#2B2B2F',
        'text-halo-width': 1.2,
      },
    },

    // ───────────────────── Labels: Places ─────────────────────
    {
      id: 'place-continent',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'continent'],
      maxzoom: 3,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': 14,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.2,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#E0E0E2',
        'text-halo-color': '#232327',
        'text-halo-width': 2,
      },
    },
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
        'text-color': '#E0E0E2',
        'text-halo-color': '#232327',
        'text-halo-width': 2,
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
        'text-color': '#C0C0C2',
        'text-halo-color': '#232327',
        'text-halo-width': 1.5,
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
        'text-color': '#EAEAEC',
        'text-halo-color': '#232327',
        'text-halo-width': 2,
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
        'text-color': '#DADADE',
        'text-halo-color': '#232327',
        'text-halo-width': 1.5,
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
        'text-color': '#C8C8CC',
        'text-halo-color': '#232327',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'place-suburb',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'suburb'],
      minzoom: 11,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13, 18, 16],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-max-width': 7,
      },
      paint: {
        'text-color': '#B0B0B4',
        'text-halo-color': '#232327',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'place-neighbourhood',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'neighbourhood'],
      minzoom: 13,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 12],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#98989E',
        'text-halo-color': '#232327',
        'text-halo-width': 1,
      },
    },

    // ───────────────────── Labels: POI ─────────────────────
    // Hidden — POI names are rendered by our custom PoiBadge overlays.
    // Showing both would duplicate the label on every marker.
    {
      id: 'poi-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 14,
      layout: {
        visibility: 'none',
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
        'text-max-width': 7,
        'text-anchor': 'top',
        'text-offset': [0, 0.5],
      },
      paint: {
        'text-color': '#B0B0B4',
        'text-halo-color': '#141416',
        'text-halo-width': 1,
      },
    },

    // ───────────────────── Labels: House Numbers ─────────────────────
    {
      id: 'housenumber',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'housenumber',
      minzoom: 17,
      layout: {
        'text-field': '{housenumber}',
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
      },
      paint: {
        'text-color': '#707072',
        'text-halo-color': '#2B2B2F',
        'text-halo-width': 0.8,
      },
    },
  ],
};

/** Serialized MapLibre style JSON for use with the `mapStyle` prop. */
export const DARK_MAP_STYLE_JSON = JSON.stringify(style);
