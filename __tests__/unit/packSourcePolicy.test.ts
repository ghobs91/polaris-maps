/**
 * Developer source pins must never starve a download.
 *
 * The pin exists to prove that the primary origin and each mirror serve
 * identical bytes, so it has to be honoured — but a pin that names a class the
 * asset has none of must fall back to every advertised origin. Returning an
 * empty source list there turns a developer toggle into "download always
 * fails", and the card does not say why.
 */

import { resolveSourceClass } from '../../src/services/regions/packSourcePolicy';

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
