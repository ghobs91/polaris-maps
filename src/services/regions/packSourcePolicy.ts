/**
 * Which class of origin a pack asset may be fetched from.
 *
 * Normally every advertised origin is in play: `mirrorHealth` rotates first
 * attempts across them and demotes one that fails, so a pack arrives from
 * whichever origin is healthy. The developer-only pins exist because two
 * origins serving "the same" bytes is an assumption worth testing, and the only
 * way to test it is to fetch from each on its own.
 *
 * Pure and free of native imports so the decision is unit tested directly, in
 * the same shape as `peerDownloadPolicy` and `photonFallbackPolicy`.
 */

import type { PackSourceChoice } from '../../stores/settingsStore';

/** The origins an asset will actually be requested from. */
export type PackSourceClass = 'all' | 'primary' | 'mirror';

/**
 * Resolve the effective source class.
 *
 * A pin that names a class the asset has none of falls back to `all` instead of
 * failing the transfer: picking "Archive" for a region whose catalog advertises
 * no mirror should download the pack, not produce an empty source list. The
 * caller surfaces that state in the UI rather than hiding it.
 */
export function resolveSourceClass(
  hasPrimary: boolean,
  hasMirror: boolean,
  choice: PackSourceChoice,
): PackSourceClass {
  if (choice === 'primary' && hasPrimary) return 'primary';
  if (choice === 'mirror' && hasMirror) return 'mirror';
  return 'all';
}

/**
 * Build the mirror URL for an asset the catalog does not advertise one for.
 *
 * The developer picker has to be able to exercise the mirror *before* the
 * catalog advertises it: flipping `POLARIS_PACK_MIRROR_BASES` is what tells
 * every client to start using it, so waiting for that to test it is circular.
 * The layout is the one `stampCatalog` writes and `publish-region-mirrors.sh`
 * uploads — `${base}/${tag}/${fileName}` — with both parts read out of the
 * primary URL, so the two can never disagree about the path.
 *
 * Returns null when the primary is not a release-download URL: an unexpected
 * catalog shape then produces no source at all, instead of a 404 the caller
 * cannot explain.
 */
export function synthesizeMirrorUrl(
  primaryUrl: string | null | undefined,
  mirrorBase: string | null | undefined,
): string | null {
  const base = (mirrorBase ?? '').trim().replace(/\/+$/, '');
  if (!base || !primaryUrl) return null;
  const match = /\/releases\/download\/([^/]+)\/([^/]+)$/.exec(primaryUrl);
  if (!match) return null;
  return `${base}/${match[1]}/${match[2]}`;
}
