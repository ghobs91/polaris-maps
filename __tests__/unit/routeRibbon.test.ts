import { DARK_MAP_STYLE_JSON } from '../../src/constants/darkMapStyle';
import { applyNavigationFocus } from '../../src/services/map/navFocusStyle';
import { buildRibbon, zoomWidth, type RibbonBand } from '../../src/components/map/routeRibbon';

/** Evaluate a MapLibre zoom `interpolate` (or a `*` wrap of one) at a zoom. */
function evalWidth(expr: unknown, zoom: number): number | null {
  if (typeof expr === 'number') return expr;
  if (!Array.isArray(expr)) return null;
  const e = expr as unknown[];
  if (e[0] === '*') {
    const inner = evalWidth(e[1], zoom);
    const factor = typeof e[2] === 'number' ? e[2] : null;
    return inner != null && factor != null ? inner * factor : null;
  }
  if (e[0] === 'interpolate') {
    const stops: Array<[number, number]> = [];
    for (let i = 3; i + 1 < e.length; i += 2) stops.push([e[i] as number, e[i + 1] as number]);
    if (stops.length === 0) return null;
    if (zoom <= stops[0][0]) return stops[0][1];
    if (zoom >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const [z0, v0] = stops[i];
      const [z1, v1] = stops[i + 1];
      if (zoom >= z0 && zoom <= z1) return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return null;
}

function band(bands: RibbonBand[], suffix: string): RibbonBand {
  const found = bands.find((b) => b.id.endsWith(suffix));
  if (!found) throw new Error(`no ${suffix} band`);
  return found;
}

/** Road fill width from the navigation-focus style, at a zoom. */
function navRoadWidth(layerId: string, zoom: number): number {
  const style = JSON.parse(applyNavigationFocus(DARK_MAP_STYLE_JSON, true));
  const layer = style.layers.find((l: { id: string }) => l.id === layerId);
  const width = evalWidth(layer?.paint['line-width'], zoom);
  if (width == null) throw new Error(`no width for ${layerId}`);
  return width;
}

describe('routeRibbon', () => {
  describe('the ribbon covers the road it is drawn on', () => {
    // The invariant a driver sees directly: if the carriageway is wider than
    // the ribbon, the road shows through as a grey stripe either side. This
    // spans routeRibbon and navFocusStyle, which is why it lives here.
    it.each([15, 16, 17])('line >= primary road fill at zoom %i', (zoom) => {
      const bands = buildRibbon('route-x', '#2FD4F2', true, true, true);
      const line = evalWidth(band(bands, '-line').width, zoom)!;
      const primary = navRoadWidth('road-primary', zoom);
      expect(line).toBeGreaterThanOrEqual(primary);
    });

    it('casing covers the widest road a route can sit on', () => {
      const bands = buildRibbon('route-x', '#2FD4F2', true, true, true);
      const casing = evalWidth(band(bands, '-casing').width, 17)!;
      expect(casing).toBeGreaterThanOrEqual(navRoadWidth('road-motorway', 17));
    });

    it('is not wider than the browse ribbon when not navigating', () => {
      const browse = buildRibbon('route-x', '#2FD4F2', true, true, false);
      const nav = buildRibbon('route-x', '#2FD4F2', true, true, true);
      for (const suffix of ['-casing', '-glow', '-line', '-core']) {
        expect(evalWidth(band(nav, suffix).width, 17)!).toBeGreaterThan(
          evalWidth(band(browse, suffix).width, 17)!,
        );
      }
    });
  });

  describe('band ordering', () => {
    it.each([10, 14, 17])('casing > glow > line > core at zoom %i', (zoom) => {
      const bands = buildRibbon('route-x', '#2FD4F2', true, true, true);
      const widths = ['-casing', '-glow', '-line', '-core'].map(
        (s) => evalWidth(band(bands, s).width, zoom)!,
      );
      for (let i = 0; i < widths.length - 1; i++) {
        expect(widths[i]).toBeGreaterThan(widths[i + 1]);
      }
    });
  });

  describe('bands', () => {
    it('gives the dark ribbon four bands and the light ribbon two', () => {
      expect(buildRibbon('r', '#fff', true, true, false).map((b) => b.id)).toEqual([
        'r-casing',
        'r-glow',
        'r-line',
        'r-core',
      ]);
      expect(buildRibbon('r', '#fff', false, true, false).map((b) => b.id)).toEqual([
        'r-casing',
        'r-line',
      ]);
    });

    it('keeps every band mounted but transparent while the source is hidden', () => {
      const hidden = buildRibbon('r', '#fff', true, false, false);
      expect(hidden.every((b) => b.opacity === 0)).toBe(true);
      expect(buildRibbon('r', '#fff', true, true, false).every((b) => b.opacity === 1)).toBe(true);
    });

    it('paints the line band with the per-feature traffic colour', () => {
      const bands = buildRibbon('r', ['get', 'color'], true, true, false);
      expect(band(bands, '-line').color).toEqual(['get', 'color']);
    });
  });

  describe('zoomWidth', () => {
    it('interpolates linearly between its stops', () => {
      const expr = zoomWidth([2, 4, 8]);
      expect(evalWidth(expr, 10)).toBe(2);
      expect(evalWidth(expr, 14)).toBe(4);
      expect(evalWidth(expr, 17)).toBe(8);
      expect(evalWidth(expr, 12)).toBe(3);
      // Clamped outside the stop range.
      expect(evalWidth(expr, 5)).toBe(2);
      expect(evalWidth(expr, 22)).toBe(8);
    });
  });
});
