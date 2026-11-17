/**
 * Developer source pins must never starve a download.
 *
 * The pin exists to prove that the primary origin and each mirror serve
 * identical bytes, so it has to be honoured — but a pin that names a class the
 * asset has none of must fall back to every advertised origin. Returning an
 * empty source list there turns a developer toggle into "download always
 * fails", and the card does not say why.
 */

import {
  preferredSources,
  resolveSourceClass,
  synthesizeMirrorUrl,
} from '../../src/services/regions/packSourcePolicy';

describe('resolveSourceClass', () => {
  it('uses every origin when unpinned', () => {
    expect(resolveSourceClass(true, true, 'auto')).toBe('all');
    expect(resolveSourceClass(true, false, 'auto')).toBe('all');
    expect(resolveSourceClass(false, true, 'auto')).toBe('all');
  });

  it('pins the primary origin', () => {
    expect(resolveSourceClass(true, true, 'primary')).toBe('primary');
    expect(resolveSourceClass(true, false, 'primary')).toBe('primary');
  });

  it('pins the mirror origin', () => {
    expect(resolveSourceClass(true, true, 'mirror')).toBe('mirror');
    expect(resolveSourceClass(false, true, 'mirror')).toBe('mirror');
  });

  it('falls back when the pinned class does not exist', () => {
    // A region whose catalog entry carries no mirrors: "Archive" must not
    // produce an empty source list.
    expect(resolveSourceClass(true, false, 'mirror')).toBe('all');
    // An asset with no primary URL (mirror-only catalog): "GitHub" likewise.
    expect(resolveSourceClass(false, true, 'primary')).toBe('all');
    // Neither: nothing to pin, still every (empty) origin.
    expect(resolveSourceClass(false, false, 'mirror')).toBe('all');
  });
});

describe('synthesizeMirrorUrl', () => {
  const primary =
    'https://github.com/ghobs91/polaris-maps/releases/download/map-data-2026-11-a/us-ny-new-york-tiles.pmtiles';

  it('mirrors the path the catalog builder stamps and the uploader writes', () => {
    expect(
      synthesizeMirrorUrl(primary, 'https://archive.org/download/polaris-maps-map-data-2026-11'),
    ).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11/map-data-2026-11-a/us-ny-new-york-tiles.pmtiles',
    );
  });

  it('tolerates whitespace and a trailing slash on the base', () => {
    expect(synthesizeMirrorUrl(primary, '  https://example.org/item/  ')).toBe(
      'https://example.org/item/map-data-2026-11-a/us-ny-new-york-tiles.pmtiles',
    );
  });

  it('produces nothing rather than a 404 when the shape is unexpected', () => {
    expect(synthesizeMirrorUrl(primary, '')).toBeNull();
    expect(synthesizeMirrorUrl(primary, null)).toBeNull();
    expect(synthesizeMirrorUrl(null, 'https://example.org/item')).toBeNull();
    // A mirror URL that is already a mirror, not a release download.
    expect(
      synthesizeMirrorUrl('https://archive.org/download/item/tag/file.pmtiles', 'https://x.org/i'),
    ).toBeNull();
  });
});

describe('preferredSources', () => {
  const primary = ['https://github.com/r/releases/download/t/a-tiles.pmtiles'];
  const mirror = ['https://archive.org/download/item/t/a-tiles.pmtiles'];

  it('puts the pinned origin first and keeps the other as a fallback', () => {
    // The mirror lags the GitHub release by a build cycle, so a strict pin
    // dead-ends on any region not uploaded yet with a bare HTTP 404.
    expect(preferredSources(primary, mirror, 'mirror')).toEqual([...mirror, ...primary]);
    expect(preferredSources(primary, mirror, 'primary')).toEqual([...primary, ...mirror]);
  });

  it('is deterministic — a pin that rotates is not a pin', () => {
    const many = ['https://b/x', 'https://c/x'];
    expect(preferredSources(primary, many, 'mirror')).toEqual([...many, ...primary]);
    expect(preferredSources(primary, many, 'mirror')).toEqual([...many, ...primary]);
  });

  it('dedupes, so a mirrored primary is not fetched twice', () => {
    expect(preferredSources(primary, [...primary, ...mirror], 'mirror')).toEqual([
      ...primary,
      ...mirror,
    ]);
  });

  it('still returns the other origin when the pinned class is empty', () => {
    expect(preferredSources(primary, [], 'mirror')).toEqual(primary);
    expect(preferredSources([], mirror, 'primary')).toEqual(mirror);
  });
});
