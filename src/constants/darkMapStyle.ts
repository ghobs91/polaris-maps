/**
 * Custom MapLibre dark-mode style inspired by Apple Maps' dark appearance.
 *
 * Characteristics:
 *   - Deep blue-gray land (#1C1C2E)
 *   - Muted green parks and vegetation
 *   - Clear road hierarchy with good contrast
 *   - Readable labels with dark halos
 *   - Dark navy water with visible contrast
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
      paint: { 'background-color': '#1C1C2E' },
    },

    // ───────────────────── Landcover ─────────────────────
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wood'],
      paint: { 'fill-color': '#1F3D28', 'fill-opacity': 0.7 },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'grass'],
      paint: { 'fill-color': '#1F3D28', 'fill-opacity': 0.6 },
    },
    {
      id: 'landcover-farmland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'farmland'],
      paint: { 'fill-color': '#2A2A45', 'fill-opacity': 0.35 },
    },
    {
      id: 'landcover-ice',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'ice'],
      paint: { 'fill-color': '#32324E', 'fill-opacity': 0.6 },
    },
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'sand'],
      paint: { 'fill-color': '#3A3548', 'fill-opacity': 0.5 },
    },
    {
      id: 'landcover-wetland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wetland'],
      paint: { 'fill-color': '#1E3538', 'fill-opacity': 0.6 },
    },

    // ───────────────────── Landuse ─────────────────────
    {
      id: 'landuse-residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'residential'],
      paint: { 'fill-color': '#2A2A48', 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-commercial',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'commercial', 'retail'],
      paint: { 'fill-color': '#30304E', 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-industrial',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'industrial'],
      paint: { 'fill-color': '#2E2E48', 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'park', 'garden', 'playground'],
      paint: { 'fill-color': '#2A4E34', 'fill-opacity': 0.75 },
    },
    {
      id: 'landuse-cemetery',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'cemetery'],
      paint: { 'fill-color': '#2E3E40', 'fill-opacity': 0.55 },
    },
    {
      id: 'landuse-hospital',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'hospital'],
      paint: { 'fill-color': '#352E4A', 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-school',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'school'],
      paint: { 'fill-color': '#332E4E', 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-stadium',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'stadium', 'pitch'],
      paint: { 'fill-color': '#2A4E34', 'fill-opacity': 0.55 },
    },

    // Park overlay (named parks from dedicated source layer)
    {
      id: 'park-fill',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': '#2A4E34', 'fill-opacity': 0.65 },
    },

    // ───────────────────── Water ─────────────────────
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#141428' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#141428',
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
        'fill-color': '#363650',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.6, 17, 0.8],
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
        'line-color': '#484868',
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
        'line-color': '#40405E',
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
        'line-color': '#3E3E5C',
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
        'line-color': '#464664',
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
        'line-color': '#50506C',
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
        'line-color': '#5A5A78',
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
        'line-color': '#62628A',
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
        'line-color': '#6A6A90',
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
        'line-color': '#141426',
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
        'line-color': '#141426',
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
        'line-color': '#181830',
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
        'line-color': '#181830',
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
        'line-color': '#3E3E5C',
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
        'line-color': '#44445E',
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
        'line-color': '#505070',
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
        'line-color': '#5E5E7E',
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
        'line-color': '#6C6C8E',
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
        'line-color': '#7A7A9C',
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
        'line-color': '#8888AA',
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
        'line-color': '#4A4A68',
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
        'line-color': '#2E2E48',
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
        'line-color': '#141426',
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
          '#8888AA',
          'trunk',
          '#7A7A9C',
          'primary',
          '#6C6C8E',
          'secondary',
          '#5E5E7E',
          '#505070',
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
        'line-color': '#5E5E82',
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
        'line-color': '#505072',
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
        'text-color': '#5E85A8',
        'text-halo-color': '#0E0E1E',
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
        'text-color': '#5E85A8',
        'text-halo-color': '#0E0E1E',
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
        'text-color': '#5E85A8',
        'text-halo-color': '#0E0E1E',
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
        'text-color': '#B0B0CC',
        'text-halo-color': '#1C1C2E',
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
        'text-color': '#A5A5C2',
        'text-halo-color': '#1C1C2E',
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
        'text-color': '#9898B5',
        'text-halo-color': '#1C1C2E',
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
        'text-color': '#CDCDE0',
        'text-halo-color': '#141426',
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
        'text-color': '#CDCDE0',
        'text-halo-color': '#141426',
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
        'text-color': '#B0B0CC',
        'text-halo-color': '#141426',
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
        'text-color': '#DCDCEE',
        'text-halo-color': '#141426',
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
        'text-color': '#D0D0E5',
        'text-halo-color': '#141426',
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
        'text-color': '#C0C0D8',
        'text-halo-color': '#141426',
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
        'text-color': '#A8A8C2',
        'text-halo-color': '#141426',
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
        'text-color': '#9898B5',
        'text-halo-color': '#141426',
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
        'text-color': '#A8A8C2',
        'text-halo-color': '#141426',
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
        'text-color': '#7878A0',
        'text-halo-color': '#1C1C2E',
        'text-halo-width': 0.8,
      },
    },
  ],
};

/** Serialized MapLibre style JSON for use with the `mapStyle` prop. */
export const DARK_MAP_STYLE_JSON = JSON.stringify(style);
