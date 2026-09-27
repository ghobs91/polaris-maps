import { DARK_MAP_STYLE_JSON } from '../../src/constants/darkMapStyle';
import { LIGHT_MAP_STYLE_JSON } from '../../src/constants/lightMapStyle';
import { SATELLITE_STYLE_JSON } from '../../src/constants/satelliteStyle';
import { applyNavigationFocus } from '../../src/services/map/navFocusStyle';

interface Layer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

function layers(styleJson: string): Layer[] {
  return JSON.parse(styleJson).layers as Layer[];
}

function layer(styleJson: string, id: string): Layer | undefined {
  return layers(styleJson).find((l) => l.id === id);
}

const LAYER_IDS = layers(DARK_MAP_STYLE_JSON).map((l) => l.id);

/** Rough perceived brightness of a `#rrggbb` colour, for ordering checks. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/**
 * Shape signature of a paint value: array structure and literal *types* kept,
 * every number and string replaced by a placeholder. Two values with the same
 * signature differ only in their literals.
 *
 * This is the guard against the crash class that motivated it: nav focus must
 * change numbers, never expression shape. Wrapping a value in `['*', …]` changes
 * the signature, and MapLibre Native aborts the app (`SIGABRT` in
 * `setLineWidth:withReactStyleValue:`) on an expression shape it cannot
 * type-check for the property.
 */
function shapeSignature(value: unknown): unknown {
  if (typeof value === 'number') return 'n';
  if (typeof value === 'string') return 's';
  if (typeof value === 'boolean') return 'b';
  if (Array.isArray(value)) return value.map(shapeSignature);
  return value;
}

describe('applyNavigationFocus', () => {
  describe('hidden layers', () => {
    it.each([
      'poi-label',
      'housenumber',
      'road-label-secondary',
      'road-label-minor',
      'place-suburb',
      'place-neighbourhood',
      'water-name-lake',
    ])('hides %s on the dark style', (id) => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      expect(layer(focused, id)?.layout?.visibility).toBe('none');
    });

    it('hides the light-only water-name-other layer', () => {
      const focused = applyNavigationFocus(LIGHT_MAP_STYLE_JSON, false);
      expect(layer(focused, 'water-name-other')?.layout?.visibility).toBe('none');
    });

    it('keeps the road names and place anchors a driver navigates by', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      expect(layer(focused, 'road-label-primary')?.layout?.visibility).not.toBe('none');
      expect(layer(focused, 'place-town')?.layout?.visibility).not.toBe('none');
      expect(layer(focused, 'place-city')?.layout?.visibility).not.toBe('none');
    });

    it('leaves the route, road geometry and traffic interchange layers alone', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      for (const id of ['road-motorway', 'road-primary', 'road-motorway-casing', 'bridge-fill']) {
        expect(layer(focused, id)?.layout?.visibility).toBeUndefined();
      }
    });
  });

  describe('ground cover', () => {
    it('leaves parks, landuse and landcover at browse strength', () => {
      // Fading these drained the greens out of navigation, where they are one
      // of the few remaining "where am I" cues. Pinned so it stays that way.
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      const groundCover = [
        ...LAYER_IDS.filter((id) => id.startsWith('landcover-')),
        ...LAYER_IDS.filter((id) => id.startsWith('landuse-')),
        'park-fill',
      ];
      expect(groundCover.length).toBeGreaterThan(15);
      for (const id of groundCover) {
        expect(layer(focused, id)?.paint?.['fill-opacity']).toEqual(
          layer(DARK_MAP_STYLE_JSON, id)?.paint?.['fill-opacity'],
        );
      }
    });

    it('leaves buildings at their browse opacity so they stay visible', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      for (const id of ['building', 'building-3d']) {
        const key = id === 'building-3d' ? 'fill-extrusion-opacity' : 'fill-opacity';
        expect(layer(focused, id)?.paint?.[key]).toEqual(
          layer(DARK_MAP_STYLE_JSON, id)?.paint?.[key],
        );
      }
    });

    it('keeps the aerial imagery untouched on the satellite hybrid', () => {
      const focused = applyNavigationFocus(SATELLITE_STYLE_JSON, false);
      expect(layers(focused).filter((l) => l.type === 'raster')).toEqual(
        layers(SATELLITE_STYLE_JSON).filter((l) => l.type === 'raster'),
      );
    });
  });

  describe('carriageway tone', () => {
    it('lifts the road fills towards white', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      for (const id of ['road-motorway', 'road-primary', 'road-minor']) {
        const before = layer(DARK_MAP_STYLE_JSON, id)?.paint?.['line-color'] as string;
        const after = layer(focused, id)?.paint?.['line-color'] as string;
        expect(after).not.toBe(before);
        expect(luminance(after)).toBeGreaterThan(luminance(before));
      }
    });

    it('preserves the motorway -> minor hierarchy when lifting', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      const lum = (id: string) => luminance(layer(focused, id)?.paint?.['line-color'] as string);
      expect(lum('road-motorway')).toBeGreaterThan(lum('road-trunk'));
      expect(lum('road-trunk')).toBeGreaterThan(lum('road-primary'));
      expect(lum('road-primary')).toBeGreaterThan(lum('road-secondary'));
      expect(lum('road-secondary')).toBeGreaterThan(lum('road-minor'));
    });

    it('lifts every arm of bridge-fill, which re-states the road colours', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      const expression = JSON.stringify(layer(focused, 'bridge-fill')?.paint?.['line-color']);
      // The nested match on road class survives, and its motorway arm now
      // matches the lifted motorway road exactly.
      expect(expression).toContain('"match"');
      expect(expression.toUpperCase()).toContain(
        (layer(focused, 'road-motorway')?.paint?.['line-color'] as string).toUpperCase(),
      );
      expect(layer(focused, 'bridge-fill')?.paint?.['line-color']).not.toEqual(
        layer(DARK_MAP_STYLE_JSON, 'bridge-fill')?.paint?.['line-color'],
      );
    });

    it('leaves casings dark — they are the gap to the land', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      for (const id of ['road-motorway-casing', 'road-primary-casing']) {
        expect(layer(focused, id)?.paint?.['line-color']).toEqual(
          layer(DARK_MAP_STYLE_JSON, id)?.paint?.['line-color'],
        );
      }
    });

    it('does not touch the transparent or malformed colours', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      // rgba() literals are not hex and must pass through unchanged.
      const anyRgba = layers(focused).find(
        (l) =>
          typeof l.paint?.['line-color'] === 'string' &&
          (l.paint['line-color'] as string).startsWith('rgba'),
      );
      if (anyRgba) {
        const before = layers(DARK_MAP_STYLE_JSON).find((l) => l.id === anyRgba.id);
        expect(anyRgba.paint?.['line-color']).toEqual(before?.paint?.['line-color']);
      }
    });
  });

  describe('road widths', () => {
    it('scales the width stops of a road and its casing, in place', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      for (const id of ['road-primary', 'road-primary-casing']) {
        const before = layer(DARK_MAP_STYLE_JSON, id)?.paint?.['line-width'] as unknown[];
        const after = layer(focused, id)?.paint?.['line-width'] as unknown[];

        // Same expression, no wrapper — that is what keeps MapLibre happy.
        expect(after[0]).toBe('interpolate');
        expect(after).toHaveLength(before.length);
        // Zoom stops (odd indices from 3) are untouched...
        for (let i = 3; i < after.length; i += 2) expect(after[i]).toBe(before[i]);
        // ...and every output (even indices from 4) is scaled.
        for (let i = 4; i < after.length; i += 2) {
          expect(after[i]).toBeCloseTo((before[i] as number) * 1.35, 5);
          expect(after[i]).not.toBe(before[i]);
        }
      }
    });

    it('scales nested match arms in bridge-fill without disturbing them', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      const width = layer(focused, 'bridge-fill')?.paint?.['line-width'] as unknown[];
      const browse = layer(DARK_MAP_STYLE_JSON, 'bridge-fill')?.paint?.['line-width'] as unknown[];

      expect(width[0]).toBe('interpolate');
      expect(width).toHaveLength(browse.length);

      // Locate the road-class match structurally rather than by a magic index.
      const findMatch = (expr: unknown): unknown[] | undefined =>
        (expr as unknown[]).find((v) => Array.isArray(v) && v[0] === 'match') as
          | unknown[]
          | undefined;
      const beforeArms = findMatch(browse);
      const afterArms = findMatch(width);
      expect(beforeArms).toBeDefined();
      expect(afterArms).toBeDefined();
      expect(afterArms![0]).toBe('match');
      expect(afterArms).toHaveLength(beforeArms!.length);
      // ['match', ['get','class'], 'motorway', 9.45, ...] — the feature input
      // and the class labels are untouched, only the numeric arms move.
      expect(afterArms![1]).toEqual(beforeArms![1]);
      expect(afterArms![2]).toBe(beforeArms![2]);
      expect(afterArms![3]).toBeCloseTo((beforeArms![3] as number) * 1.35, 5);
      expect(afterArms![3]).not.toBe(beforeArms![3]);
    });

    it('leaves an unrecognised expression shape alone rather than guessing', () => {
      const style = JSON.stringify({
        version: 8,
        sources: { openmaptiles: { type: 'vector', url: 'https://example.test/tiles' } },
        layers: [
          { id: 'road-primary', type: 'line', paint: { 'line-width': ['coalesce', 2, 4] } },
          { id: 'road-minor', type: 'line', paint: { 'line-width': 3 } },
        ],
      });
      const focused = JSON.parse(applyNavigationFocus(style, true));
      const width = (id: string) =>
        focused.layers.find((l: { id: string }) => l.id === id)?.paint['line-width'];
      // `coalesce` is not a shape we scale — returned as-is, not corrupted.
      expect(width('road-primary')).toEqual(['coalesce', 2, 4]);
      // A bare literal still scales.
      expect(width('road-minor')).toBeCloseTo(4.05, 5);
    });

    it('leaves footpaths, rail and waterways at their browse width', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      for (const id of ['road-path', 'road-rail', 'road-rail-dash', 'waterway']) {
        expect(layer(focused, id)?.paint?.['line-width']).toEqual(
          layer(DARK_MAP_STYLE_JSON, id)?.paint?.['line-width'],
        );
      }
    });
  });

  describe('water', () => {
    it('brightens dark-mode water and its waterways', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      expect(layer(focused, 'water')?.paint?.['fill-color']).toBe('#1B5E7D');
      expect(layer(focused, 'waterway')?.paint?.['line-color']).toBe('#2A7DA0');
      expect(layer(DARK_MAP_STYLE_JSON, 'water')?.paint?.['fill-color']).toBe('#15405C');
    });

    it('leaves light-mode water at its browse colour', () => {
      const focused = applyNavigationFocus(LIGHT_MAP_STYLE_JSON, false);
      expect(layer(focused, 'water')?.paint?.['fill-color']).toBe(
        layer(LIGHT_MAP_STYLE_JSON, 'water')?.paint?.['fill-color'],
      );
    });
  });

  describe('robustness', () => {
    it('never reshapes an expression — only the numbers inside it change', () => {
      // The invariant that keeps the native side from aborting. Every paint
      // value must keep its exact array structure; only literals may move.
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      const before = layers(DARK_MAP_STYLE_JSON);
      const after = layers(focused);
      expect(after).toHaveLength(before.length);

      let checked = 0;
      for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        const keys = new Set([...Object.keys(b.paint ?? {}), ...Object.keys(a.paint ?? {})]);
        for (const key of keys) {
          expect([b.id, key, shapeSignature(a.paint?.[key])]).toEqual([
            b.id,
            key,
            shapeSignature(b.paint?.[key]),
          ]);
          checked += 1;
        }
        // Layout may only gain `visibility: hidden`.
        const layoutKeys = new Set([
          ...Object.keys(b.layout ?? {}),
          ...Object.keys(a.layout ?? {}),
        ]);
        for (const key of layoutKeys) {
          if (key === 'visibility') continue;
          expect([b.id, key, shapeSignature(a.layout?.[key])]).toEqual([
            b.id,
            key,
            shapeSignature(b.layout?.[key]),
          ]);
        }
      }
      expect(checked).toBeGreaterThan(100);
    });

    it('introduces no arithmetic expression wrappers anywhere', () => {
      // Belt and braces on the same invariant, stated the way a reviewer would
      // look for it.
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      const wrapped: string[] = [];
      const walk = (value: unknown, path: string) => {
        if (Array.isArray(value)) {
          if (value[0] === '*' && Array.isArray(value[1])) wrapped.push(path);
          value.forEach((v, i) => walk(v, `${path}[${i}]`));
        }
      };
      for (const l of layers(focused)) {
        for (const [k, v] of Object.entries(l.paint ?? {})) walk(v, `${l.id}.${k}`);
      }
      expect(wrapped).toEqual([]);
    });

    it('returns the input unchanged when the JSON is unparseable', () => {
      expect(applyNavigationFocus('not json', true)).toBe('not json');
    });

    it('returns the input unchanged when there are no layers', () => {
      const noLayers = JSON.stringify({ version: 8, sources: {} });
      expect(applyNavigationFocus(noLayers, true)).toBe(noLayers);
    });

    it('passes a pure-raster style through untouched', () => {
      const fallback = JSON.stringify({
        version: 8,
        name: 'Polaris iOS26 Compat Dark',
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
        },
        layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }],
      });
      expect(JSON.parse(applyNavigationFocus(fallback, true))).toEqual(JSON.parse(fallback));
    });

    it('only strips labels from the satellite hybrid — imagery is untouched', () => {
      const focused = applyNavigationFocus(SATELLITE_STYLE_JSON, false);
      expect(layer(focused, 'road-label-minor')?.layout?.visibility).toBe('none');
      expect(layer(focused, 'water-name-other')?.layout?.visibility).toBe('none');
      // The imagery and the road names a driver still needs survive.
      expect(layer(focused, 'road-label-primary')?.layout?.visibility).toBeUndefined();
      const raster = layers(focused).filter((l) => l.type === 'raster');
      expect(raster).toEqual(layers(SATELLITE_STYLE_JSON).filter((l) => l.type === 'raster'));
    });

    it('does not mutate the source style constant', () => {
      const before = DARK_MAP_STYLE_JSON;
      applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      expect(DARK_MAP_STYLE_JSON).toBe(before);
      expect(layer(DARK_MAP_STYLE_JSON, 'water')?.paint?.['fill-color']).toBe('#15405C');
    });

    it('keeps the layer count and order identical to the browse style', () => {
      const focused = applyNavigationFocus(DARK_MAP_STYLE_JSON, true);
      expect(layers(focused).map((l) => l.id)).toEqual(
        layers(DARK_MAP_STYLE_JSON).map((l) => l.id),
      );
    });
  });
});
