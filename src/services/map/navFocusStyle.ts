/**
 * Navigation focus: the browse basemap with turn-by-turn clutter removed.
 *
 * Navigation views deliberately recede the basemap so the route ribbon is the
 * only high-chroma object on screen. Forking the light/dark style constants
 * into two more 1,100-line files would mean keeping four in sync, so the
 * navigation variant is derived from the already-resolved browse style at
 * runtime instead.
 *
 * What changes while a trip is active:
 *   - Context labels with no driving value are hidden: neighbourhood/suburb
 *     names, secondary/minor road names, lake names, house numbers and POI
 *     labels. Motorway/trunk/primary road names and town/city anchors stay, so
 *     the driver keeps their bearings.
 *   - Roads a car can drive on are drawn heavier. At the navigation camera's
 *     zoom 17 the browse widths land around 9pt for a primary road; navigation
 *     maps draw arterials around a third heavier so the carriageway is legible
 *     at a glance and while moving.
 *   - Carriageways are lifted in tone. The navigation camera is pitched 55°,
 *     which shows the *lit vertical faces* of extruded buildings rather than
 *     their darker roofs, so roads that sit close to the building tone in plan
 *     view blend into them on screen.
 *   - On the dark style, water brightens. That widens the hue gap against the
 *     land without raising luminance contrast, which is what makes a dark
 *     navigation map read instantly at a glance.
 *
 * Ground cover is deliberately left alone. Fading parks and landcover does
 * make the basemap recede, but it also drains the greens out of navigation,
 * where they are one of the few remaining cues for "where am I". The label
 * hiding above already carries the decluttering on its own.
 *
 * Pure JSON in/out — no native or Expo imports, so it stays unit-testable.
 *
 * Every change is keyed by layer id, so styles that lack a layer simply skip
 * that change. The satellite style is a hybrid (raster imagery under a vector
 * label overlay), so it still loses its context labels; the pure-raster styles
 * (terrain, the iOS 26 compatibility fallback) match nothing and pass through
 * unchanged.
 */

/** Layers hidden outright while turn-by-turn navigation is active. */
const NAV_HIDDEN_LAYER_IDS: readonly string[] = [
  'poi-label',
  'housenumber',
  'road-label-secondary',
  'road-label-minor',
  'place-suburb',
  'place-neighbourhood',
  'water-name-lake',
  // Present in the light style only.
  'water-name-other',
];

/**
 * Everything a car can drive on: fills, their casings, bridges and tunnels.
 * Footpaths, rail and waterways keep their browse widths — widening those
 * would only add clutter. Ids absent from a style are skipped.
 */
const NAV_WIDENED_ROAD_LAYER_IDS: readonly string[] = [
  'road-motorway',
  'road-motorway-casing',
  'road-trunk',
  'road-trunk-casing',
  'road-primary',
  'road-primary-casing',
  'road-secondary',
  'road-secondary-casing',
  'road-minor',
  'road-minor-casing',
  'road-service',
  'road-service-casing',
  // Bridges and tunnels carry the same traffic, so they move with the roads.
  'bridge-fill',
  'bridge-casing',
  'bridge-motorway',
  'bridge-trunk',
  'bridge-primary',
  'bridge-secondary',
  'bridge-minor',
  'bridge-service',
  'tunnel-motorway',
  'tunnel-trunk',
  'tunnel-primary',
  'tunnel-secondary',
  'tunnel-minor',
  'tunnel-service',
];

/**
 * Layers whose carriageway tone is lifted under navigation. `bridge-fill`
 * re-states the road colours in a nested `match` on road class, so it has to
 * move with them or a bridge would read darker than the road it continues.
 *
 * Casings are deliberately left dark: they are the gap between the lifted
 * carriageway and the land, and lifting them too would flatten the pair.
 */
const NAV_LIGHTENED_ROAD_LAYER_IDS: readonly string[] = [
  'road-motorway',
  'road-trunk',
  'road-primary',
  'road-secondary',
  'road-minor',
  'road-service',
  'bridge-fill',
];

/**
 * Carriageway width multiplier under navigation. Fills and casings take the
 * same factor so their proportional gap is preserved.
 */
const NAV_ROAD_WIDTH_SCALE = 1.35;

/** How far each carriageway colour moves towards white under navigation. */
const NAV_ROAD_LIGHTEN = 0.25;

/**
 * Water on the dark basemap: `#15405C` is close enough in luminance to the
 * `#18262E` land that the two read as one field at a glance.
 */
const DARK_NAV_WATER_FILL = '#1B5E7D';
const DARK_NAV_WATERWAY_LINE = '#2A7DA0';

const HIDDEN_LAYER_IDS = new Set(NAV_HIDDEN_LAYER_IDS);
const WIDENED_ROAD_LAYER_IDS = new Set(NAV_WIDENED_ROAD_LAYER_IDS);
const LIGHTENED_ROAD_LAYER_IDS = new Set(NAV_LIGHTENED_ROAD_LAYER_IDS);

interface StyleLayer {
  id?: string;
  type?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Style {
  layers?: StyleLayer[];
  [key: string]: unknown;
}

/**
 * Keep scaled widths readable: raw float multiplication emits values like
 * `4.050000000000001`, which are harmless to MapLibre but noisy in a diff and
 * in anything that inspects the resolved style.
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Scale the *output* values of a width expression in place, by factor.
 *
 * Deliberately not `['*', expression, factor]`. MapLibre Native type-checks the
 * expression against the property and raises when it cannot, which aborts the
 * app (`SIGABRT` in `setLineWidth:withReactStyleValue:` via
 * `expressionWithMLNJSONObject:`). Wrapping produced a shape no style had ever
 * shipped for `line-width`, so there was nothing to say it was legal. Rewriting
 * the numbers keeps the expression byte-for-byte the shape the style already
 * uses — it can only ever be as valid as the original.
 *
 * The walk is structure-aware on purpose: a blanket "multiply every number"
 * would also multiply the zoom stops feeding an `interpolate`, or the road-class
 * labels in `bridge-fill`'s `match`, and silently move the wrong numbers.
 * Shapes this does not recognise are returned untouched rather than guessed at.
 */
function scaleWidthExpression(value: unknown, factor: number): unknown {
  if (typeof value === 'number') return round3(value * factor);
  if (!Array.isArray(value)) return value;

  const [op] = value as unknown[];
  const out = value.slice() as unknown[];

  if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') {
    // ['interpolate', interpolation, input, in0, out0, in1, out1, ...]
    for (let i = 4; i < out.length; i += 2) out[i] = scaleWidthExpression(out[i], factor);
    return out;
  }

  if (op === 'step') {
    // ['step', input, out0, in1, out1, ...]
    out[2] = scaleWidthExpression(out[2], factor);
    for (let i = 4; i < out.length; i += 2) out[i] = scaleWidthExpression(out[i], factor);
    return out;
  }

  if (op === 'match') {
    // ['match', input, label0, out0, label1, out1, ..., fallback]
    for (let i = 3; i < out.length - 1; i += 2) out[i] = scaleWidthExpression(out[i], factor);
    out[out.length - 1] = scaleWidthExpression(out[out.length - 1], factor);
    return out;
  }

  return value;
}

/**
 * Lift a `#rrggbb` colour towards white by `amount` (0–1). Non-hex input (an
 * expression, a `rgba()` string) is returned untouched.
 */
function lightenHex(hex: string, amount: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  const lifted = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) =>
    Math.round(channel + (255 - channel) * amount),
  );
  return `#${lifted.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Lighten every hex literal inside a paint value, including the arms of a
 * nested `match` (which is how `bridge-fill` picks a colour per road class).
 */
function lightenPaintValue(value: unknown, amount: number): unknown {
  if (typeof value === 'string') return lightenHex(value, amount);
  if (Array.isArray(value)) return value.map((entry) => lightenPaintValue(entry, amount));
  return value;
}

function applyPaintOverride(layer: StyleLayer, key: string, value: unknown): void {
  layer.paint = { ...layer.paint, [key]: value };
}

/**
 * Derive the navigation-focus variant of a serialised MapLibre style.
 *
 * `isDark` selects the dark-map overrides (water); the structural changes —
 * hidden labels and faded ground cover — apply to both appearances.
 */
export function applyNavigationFocus(styleJson: string, isDark: boolean): string {
  let style: Style;
  try {
    style = JSON.parse(styleJson) as Style;
  } catch {
    return styleJson;
  }
  if (!style || typeof style !== 'object' || !Array.isArray(style.layers)) return styleJson;

  for (const layer of style.layers) {
    const id = layer?.id;
    if (typeof id !== 'string') continue;

    if (HIDDEN_LAYER_IDS.has(id)) {
      layer.layout = { ...layer.layout, visibility: 'none' };
      continue;
    }

    // Width and tone are independent concerns, and the same road layer takes
    // both — so these are separate checks rather than one exclusive branch.
    if (WIDENED_ROAD_LAYER_IDS.has(id) && layer.paint?.['line-width'] !== undefined) {
      applyPaintOverride(
        layer,
        'line-width',
        scaleWidthExpression(layer.paint['line-width'], NAV_ROAD_WIDTH_SCALE),
      );
    }

    if (LIGHTENED_ROAD_LAYER_IDS.has(id)) {
      const lightened = lightenPaintValue(layer.paint?.['line-color'], NAV_ROAD_LIGHTEN);
      if (lightened !== undefined) applyPaintOverride(layer, 'line-color', lightened);
    }

    if (isDark && id === 'water') {
      applyPaintOverride(layer, 'fill-color', DARK_NAV_WATER_FILL);
      continue;
    }

    if (isDark && id === 'waterway') {
      applyPaintOverride(layer, 'line-color', DARK_NAV_WATERWAY_LINE);
    }
  }

  return JSON.stringify(style);
}
