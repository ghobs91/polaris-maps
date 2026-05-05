/**
 * Custom MapLibre light-mode style inspired by Apple Maps' light appearance.
 *
 * Characteristics:
 *   - Light neutral background (#F5F5F0) — warm off-white
 *   - Light blue water (#C8E0F0) with clear contrast from land
 *   - Amber/gold highways (trunk/motorway) — Apple Maps signature
 *   - Neutral gray local roads
 *   - Richer green parks and grass
 *   - Dark labels with light halos for readability on light background
 *
 * Uses OpenFreeMap vector tiles (OpenMapTiles schema). No API key required.
 */

const style = {
  version: 8 as const,
  name: 'Polaris Light',
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
      paint: { 'background-color': '#F5F5F0' },
    },

    // ──────────────────── Landcover ─────────────────────
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wood'],
      paint: { 'fill-color': '#C8D8B8', 'fill-opacity': 0.5 },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'grass'],
      paint: { 'fill-color': '#D8E8C8', 'fill-opacity': 0.45 },
    },
    {
      id: 'landcover-farmland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'farmland'],
      paint: { 'fill-color': '#E8E0D0', 'fill-opacity': 0.28 },
    },
    {
      id: 'landcover-ice',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'ice'],
      paint: { 'fill-color': '#E8F0F8', 'fill-opacity': 0.45 },
    },
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'sand'],
      paint: { 'fill-color': '#F0E8D8', 'fill-opacity': 0.35 },
    },
    {
      id: 'landcover-wetland',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wetland'],
      paint: { 'fill-color': '#D0E0E8', 'fill-opacity': 0.4 },
    },

    // ───────────────────── Landuse ─────────────────────
    {
      id: 'landuse-residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'residential'],
      paint: { 'fill-color': '#E8E8E4', 'fill-opacity': 0.32 },
    },
    {
      id: 'landuse-commercial',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'commercial', 'retail'],
      paint: { 'fill-color': '#E4E4E0', 'fill-opacity': 0.32 },
    },
    {
      id: 'landuse-industrial',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'industrial'],
      paint: { 'fill-color': '#E0E0DC', 'fill-opacity': 0.3 },
    },
    {
      id: 'landuse-park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'park', 'garden', 'playground'],
      paint: { 'fill-color': '#B8D8A8', 'fill-opacity': 0.56 },
    },
    {
      id: 'landuse-cemetery',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'cemetery'],
      paint: { 'fill-color': '#C8D8C0', 'fill-opacity': 0.36 },
    },
    {
      id: 'landuse-hospital',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'hospital'],
      paint: { 'fill-color': '#F0E0E8', 'fill-opacity': 0.3 },
    },
    {
      id: 'landuse-school',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'school'],
      paint: { 'fill-color': '#E8E0F0', 'fill-opacity': 0.3 },
    },
    {
      id: 'landuse-stadium',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', 'class', 'stadium', 'pitch'],
      paint: { 'fill-color': '#B0D0A0', 'fill-opacity': 0.44 },
    },

    // Park overlay (named parks from dedicated source layer)
    {
      id: 'park-fill',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': '#C0E0B0', 'fill-opacity': 0.54 },
    },

    // ───────────────────── Water ─────────────────────
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#C8E0F0' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#C8E0F0',
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
        'fill-color': '#D8D8D4',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.58, 17, 0.78],
      },
    },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#D8D8D4',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.5, 17, 0.8],
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
        'line-color': '#C8C8C4',
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
        'line-color': '#D0D0CC',
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
        'line-color': '#D8D8D4',
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
        'line-color': '#D0D0CC',
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
        'line-color': '#C8C8C4',
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
        'line-color': '#BEBEB8',
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
        'line-color': '#E8D8A8',
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
        'line-color': '#F0E0B0',
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
        'line-color': '#E8E8E4',
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
        'line-color': '#E8E8E4',
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
        'line-color': '#E4E4E0',
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
        'line-color': '#E4E4E0',
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
        'line-color': '#C8C8C4',
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
        'line-color': '#D0D0CC',
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
        'line-color': '#C0C0BC',
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
        'line-color': '#B8B8B4',
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
        'line-color': '#A8A8A4',
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
        'line-color': '#E8D090',
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
        'line-color': '#F0D880',
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
        'line-color': '#B0B0AC',
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
        'line-color': '#D8D8D4',
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
        'line-color': '#E8E8E4',
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
      id: 'bridge-service',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'bridge'], ['==', 'class', 'service']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#D0D0CC',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 16, 1.5, 18, 4],
      },
    },
    {
      id: 'bridge-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'bridge'], ['in', 'class', 'minor', 'tertiary']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#C0C0BC',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.5, 18, 6],
      },
    },
    {
      id: 'bridge-secondary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'bridge'], ['==', 'class', 'secondary']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#B8B8B4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2, 18, 8],
      },
    },
    {
      id: 'bridge-primary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'bridge'], ['==', 'class', 'primary']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#A8A8A4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3, 18, 10],
      },
    },
    {
      id: 'bridge-trunk',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'bridge'], ['==', 'class', 'trunk']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#E8D090',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 14, 3.5, 18, 12],
      },
    },
    {
      id: 'bridge-motorway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['==', 'brunnel', 'bridge'], ['==', 'class', 'motorway']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#F0D880',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 14, 4, 18, 14],
      },
    },

    // ──────────────────── Borders ─────────────────────
    {
      id: 'border-country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['==', 'admin_level', 2],
      paint: {
        'line-color': '#B0B0AC',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 2],
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'border-state',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['==', 'admin_level', 4],
      minzoom: 4,
      paint: {
        'line-color': '#C8C8C4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 10, 1],
        'line-dasharray': [2, 2],
      },
    },

    // ──────────────────── Labels: Water ─────────────────────
    {
      id: 'water-name-ocean',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['==', 'class', 'ocean'],
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 16],
        'text-letter-spacing': 0.15,
        'text-max-width': 5,
      },
      paint: {
        'text-color': '#3A6A8A',
        'text-halo-color': '#F5F5F0',
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
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 13],
        'text-letter-spacing': 0.1,
        'text-max-width': 5,
      },
      paint: {
        'text-color': '#3A6A8A',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'water-name-lake',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['==', 'class', 'lake'],
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12],
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#3A6A8A',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1,
      },
    },
    {
      id: 'water-name-other',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['!in', 'class', 'ocean', 'sea', 'lake'],
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 11],
        'text-max-width': 5,
      },
      paint: {
        'text-color': '#3A6A8A',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 0.8,
      },
    },

    // ───────────────────── Labels: Roads ─────────────────────
    {
      id: 'road-label-primary',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
      minzoom: 12,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 12],
        'symbol-placement': 'line',
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#2A2A26',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'road-label-secondary',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['==', 'class', 'secondary'],
      minzoom: 13,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 8, 16, 11],
        'symbol-placement': 'line',
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#3A3A36',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.2,
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
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 8, 17, 10],
        'symbol-placement': 'line',
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#4A4A46',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1,
      },
    },

    // ───────────────────── Labels: Places ─────────────────────
    {
      id: 'place-continent',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'continent'],
      maxzoom: 2,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': 14,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.15,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#2A2A26',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.5,
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
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 16],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.1,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#2A2A26',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.5,
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
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#3A3A36',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'city'],
      minzoom: 5,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 15, 14, 18],
        'text-max-width': 7,
      },
      paint: {
        'text-color': '#1A1A16',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.5,
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
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 13],
        'text-max-width': 7,
      },
      paint: {
        'text-color': '#2A2A26',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1.2,
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
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 11],
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#3A3A36',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1,
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
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 12],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#4A4A46',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 1,
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
        'text-color': '#5A5A56',
        'text-halo-color': '#F5F5F0',
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
        'text-color': '#3A3A36',
        'text-halo-color': '#F5F5F0',
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
        'text-color': '#5A5A56',
        'text-halo-color': '#F5F5F0',
        'text-halo-width': 0.8,
      },
    },
  ],
};

/** Serialized MapLibre style JSON for use with the `mapStyle` prop. */
export const LIGHT_MAP_STYLE_JSON = JSON.stringify(style);
