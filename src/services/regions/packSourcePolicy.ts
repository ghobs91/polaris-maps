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
 * True when the developer pinned this pack to the mesh.
 *
 * Deliberately not a `PackSourceClass`: P2P is not an origin, and treating it as one
 * would hand the downloader an empty source list to fail on confusingly. Callers
 * branch on this *before* building an origin list.
 */
export function isP2pOnly(choice: PackSourceChoice): boolean {
  return choice === 'p2p';
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

/**
 * Ordered origin list for a pinned choice.
 *
 * A pin names what to try *first*, not the only thing to try. "Archive" on a
 * region whose mirror has not been uploaded yet — the mirror lags the GitHub
 * release by a build cycle — used to fail the whole download with a bare
 * `HTTP 404 from https://archive.org/…`, which reads like a broken mirror when
 * it only means "not mirrored yet". The fallback keeps the test usable; the
 * winning origin is logged by the downloader, so a silent fallback cannot be
 * mistaken for a working mirror.
 *
 * Deterministic order is deliberate: `orderMirrorSources` rotates for load
 * spreading, which is right for `auto` and wrong here — a pin that rotates is
 * not a pin.
 */
export function preferredSources(
  primary: ReadonlyArray<string>,
  mirrors: ReadonlyArray<string>,
  choice: PackSourceChoice,
): string[] {
  if (isP2pOnly(choice)) return [];
  const first = choice === 'mirror' ? mirrors : primary;
  const rest = choice === 'mirror' ? primary : mirrors;
  const out: string[] = [];
  for (const url of [...first, ...rest]) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
