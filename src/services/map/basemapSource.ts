/**
 * Basemap source override.
 *
 * The vector basemap has exactly one source — an OpenMapTiles-schema tilejson
 * on `tiles.openfreemap.org`, a free service run by a company that says it may
 * be discontinued at any time without notice. There is no public-interest
 * drop-in replacement: the OpenMapTiles schema is produced by planetiler, and
 * the organisations that publish it publicly are companies.
 *
 * So the fix that actually exists is the ability to *point somewhere else*
 * without shipping an app release. A signed config can set `basemapTilesUrl`
 * and every device picks it up on next launch — either a mirror of the same
 * archive, a self-hosted planetiler output, or a different provider entirely.
 *
 * The override is applied only to the `openmaptiles` vector source, never to
 * imagery, and only over https. Anything else is ignored rather than thrown:
 * a bad config value must leave the default basemap working.
 *
 * The real second source is a region pack, which replaces this source with the
 * on-device tile server entirely (see `offlineStyle`). This module covers the
 * window before a pack installs, and the case where the upstream origin has an
 * outage.
 */

import { logDiagnostic } from '../diagnostics/diagnosticsLog';

const VECTOR_SOURCE_ID = 'openmaptiles';

let _override: string | null = null;

/** True when `url` is a usable https tile template. */
export function isUsableBasemapUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Apply the signed remote override. `null`/invalid restores the default. */
export function setBasemapTilesUrl(url: unknown): void {
  if (url === null || url === undefined || url === '') {
    _override = null;
    return;
  }
  if (!isUsableBasemapUrl(url)) {
    logDiagnostic('map', 'warn', 'ignoring unusable basemapTilesUrl from remote config');
    _override = null;
    return;
  }
  _override = url;
}

/** The active override, or `null` when the bundled default is in use. */
export function getBasemapTilesUrl(): string | null {
  return _override;
}

/** Test-only. */
export function __resetBasemapSourceForTests(): void {
  _override = null;
}

/**
 * Point a style's vector basemap source at the override.
 *
 * Returns the input untouched when there is no override — the common case, and
 * the reason this costs nothing: no parse, no stringify, no allocation.
 */
export function applyBasemapSource(styleJson: string): string {
  if (!_override) return styleJson;
  try {
    const style = JSON.parse(styleJson) as {
      sources?: Record<string, { url?: string } | undefined>;
    };
    const source = style.sources?.[VECTOR_SOURCE_ID];
    if (!source || typeof source !== 'object') return styleJson;
    source.url = _override;
    return JSON.stringify(style);
  } catch {
    // A style this cannot parse is not one it should rewrite.
    return styleJson;
  }
}
