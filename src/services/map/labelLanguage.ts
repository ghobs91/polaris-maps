/**
 * Place-label localisation for the vector label overlays.
 *
 * The OpenMapTiles schema (served by OpenFreeMap) carries the local `name`
 * plus per-language fields `name:<lang>` for a large set of languages, and a
 * script-neutral `name:latin`. Styles here render labels with the literal
 * `'{name}'`, which is the *local* name — so a user in London looking at Egypt
 * sees Arabic. This module rewrites those label fields at style-resolution
 * time to prefer the user's language, falling back through `name:latin` to the
 * local `name` when no translation exists.
 *
 * Pure JSON in/out: no native or Expo imports, so it stays unit-testable and
 * can be applied to the already-serialised style constants.
 */

/** Fallback order is: user's language, Latin transliteration, then local. */
const LATIN_FIELD = 'name:latin';
const LOCAL_FIELD = 'name';

/**
 * Ordered OpenMapTiles name fields for a BCP-47-ish locale, best first.
 *
 * The primary subtag drives the language field. Script-aware cases get a
 * dedicated field (Chinese simplified/traditional, Latin-script Serbian and
 * Japanese) because `name:zh` can hold both scripts at once ("羅馬/罗马") and
 * would otherwise render the slash.
 */
export function labelNameFields(locale: string): string[] {
  const parts = String(locale ?? '')
    .toLowerCase()
    .split(/[-_]/)
    .filter(Boolean);
  const language = parts[0] ?? 'en';
  const second = parts[1] ?? '';
  const script = second.length === 4 ? second : '';
  const region = (second.length === 2 ? second : parts[2]) ?? '';

  const fields: string[] = [];
  const push = (field: string): void => {
    if (field && !fields.includes(field)) fields.push(field);
  };

  if (language === 'zh') {
    const traditional = script === 'hant' || region === 'tw' || region === 'hk' || region === 'mo';
    push(traditional ? 'name:zh-Hant' : 'name:zh-Hans');
  }
  if (language === 'sr' && script === 'latn') push('name:sr-Latn');
  if (language === 'ja' && script === 'latn') push('name:ja-Latn');

  push(`name:${language}`);
  push(LATIN_FIELD);
  push(LOCAL_FIELD);
  return fields;
}

/** MapLibre `text-field` expression: first available field wins. */
export function labelNameExpression(locale: string): unknown[] {
  return ['coalesce', ...labelNameFields(locale).map((field) => ['get', field])];
}

/**
 * The user's preferred locale (e.g. `en-US`, `ar-EG`). Falls back to `en` when
 * the runtime cannot report one, matching the speech service's locale lookup.
 */
export function getDeviceLanguage(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale;
  } catch {
    // Intl unavailable — fall through.
  }
  return 'en';
}

/**
 * Replace every `'{name}'` (local-name) label with the localised expression.
 * House numbers (`'{housenumber}'`) and any already-expression `text-field`
 * are left untouched. Returns the input unchanged when nothing matched, so the
 * unlocalised path stays byte-for-byte identical to the style constant.
 */
export function applyLabelLanguage(styleJson: string, locale: string): string {
  let style: { layers?: unknown } | null;
  try {
    style = JSON.parse(styleJson) as { layers?: unknown };
  } catch {
    return styleJson;
  }
  if (!style || !Array.isArray(style.layers)) return styleJson;

  const field = labelNameExpression(locale);
  let changed = false;
  for (const layer of style.layers as Array<Record<string, unknown>>) {
    if (layer?.type !== 'symbol') continue;
    const layout = layer.layout as Record<string, unknown> | undefined;
    if (!layout || layout['text-field'] !== '{name}') continue;
    layer.layout = { ...layout, 'text-field': field };
    changed = true;
  }
  return changed ? JSON.stringify(style) : styleJson;
}
