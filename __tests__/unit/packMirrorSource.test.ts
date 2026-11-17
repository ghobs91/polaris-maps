/**
 * The pack mirror base has to point at an item that exists.
 *
 * Items roll over monthly (`polaris-maps-map-data-YYYY-MM`), so the base is
 * resolved rather than configured: whatever the Archive says is newest, else
 * this month. A stale or hardcoded default would send a developer test at last
 * month's item and produce a 404 that looks like a broken mirror.
 */

const mockStorage = new Map<string, string>();

jest.mock('../../src/services/storage/mmkv', () => ({
  getStorageSync: () => ({
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
  }),
}));

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import {
  derivedPackMirrorBase,
  parseNewestMirrorItem,
  resolvePackMirrorBase,
} from '../../src/services/regions/packMirrorSource';

beforeEach(() => {
  mockStorage.clear();
});

describe('derivedPackMirrorBase', () => {
  it('names the current UTC month', () => {
    // 2026-11-16T12:00:00Z
    expect(derivedPackMirrorBase(Date.parse('2026-11-16T12:00:00Z'))).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11',
    );
    expect(derivedPackMirrorBase(Date.parse('2027-01-02T00:00:00Z'))).toBe(
      'https://archive.org/download/polaris-maps-map-data-2027-01',
    );
  });

  it('uses UTC, not local time, so the rollover is the same everywhere', () => {
    // 23:30 on the 31st in UTC-5 is already the next month in UTC.
    expect(derivedPackMirrorBase(Date.parse('2026-12-01T04:30:00Z'))).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-12',
    );
  });
});

describe('parseNewestMirrorItem', () => {
  it('picks the most recently added pack item', () => {
    expect(
      parseNewestMirrorItem({
        response: {
          docs: [
            { identifier: 'polaris-maps-map-data-2026-10', addeddate: '2026-10-02T00:00:00Z' },
            { identifier: 'polaris-maps-map-data-2026-11', addeddate: '2026-11-16T11:54:49Z' },
            { identifier: 'polaris-maps-map-data-2026-09', addeddate: '2026-09-02T00:00:00Z' },
          ],
        },
      }),
    ).toBe('https://archive.org/download/polaris-maps-map-data-2026-11');
  });

  it('ignores unrelated identifiers that share the prefix family', () => {
    // The Archive search API is fuzzy; `polaris*` matches other people's items.
    expect(
      parseNewestMirrorItem({
        response: {
          docs: [
            { identifier: 'polaris_202611', addeddate: '2026-11-20T00:00:00Z' },
            { identifier: 'polariscopeinche0000geor', addeddate: '2026-11-21T00:00:00Z' },
            { identifier: 'polaris-maps-map-data-2026-11', addeddate: '2026-11-16T00:00:00Z' },
          ],
        },
      }),
    ).toBe('https://archive.org/download/polaris-maps-map-data-2026-11');
  });

  it('degrades to null rather than throwing on an unexpected shape', () => {
    expect(parseNewestMirrorItem(null)).toBeNull();
    expect(parseNewestMirrorItem({})).toBeNull();
    expect(parseNewestMirrorItem({ response: { docs: 'nope' } })).toBeNull();
    expect(parseNewestMirrorItem({ response: { docs: [null, 42, {}] } })).toBeNull();
    expect(parseNewestMirrorItem({ response: { docs: [] } })).toBeNull();
  });

  it('accepts a doc without a date, so one odd row cannot hide a real item', () => {
    expect(
      parseNewestMirrorItem({
        response: { docs: [{ identifier: 'polaris-maps-map-data-2026-11' }] },
      }),
    ).toBe('https://archive.org/download/polaris-maps-map-data-2026-11');
  });
});

describe('resolvePackMirrorBase', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');

  it('prefers what the developer typed, without a trailing slash', () => {
    expect(
      resolvePackMirrorBase('https://archive.org/download/polaris-maps-map-data-2026-10/', now),
    ).toBe('https://archive.org/download/polaris-maps-map-data-2026-10');
  });

  it('falls back to this month when nothing is configured', () => {
    expect(resolvePackMirrorBase('', now)).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11',
    );
    expect(resolvePackMirrorBase(undefined, now)).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11',
    );
    expect(resolvePackMirrorBase('   ', now)).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11',
    );
  });

  it('prefers a discovered base over the derived month', () => {
    // An item published slightly after its month rolled over, or a re-run item.
    mockStorage.set(
      'packs.mirror-base.v1',
      JSON.stringify({ base: 'https://archive.org/download/polaris-maps-map-data-2026-11-b' }),
    );
    expect(resolvePackMirrorBase('', now)).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11-b',
    );
    // An explicit setting still wins over the discovered one.
    expect(resolvePackMirrorBase('https://archive.org/download/explicit', now)).toBe(
      'https://archive.org/download/explicit',
    );
  });

  it('ignores a corrupt cache entry instead of propagating it', () => {
    mockStorage.set('packs.mirror-base.v1', 'not json');
    expect(resolvePackMirrorBase('', now)).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11',
    );
    mockStorage.set('packs.mirror-base.v1', JSON.stringify({ base: 'ftp://nope' }));
    expect(resolvePackMirrorBase('', now)).toBe(
      'https://archive.org/download/polaris-maps-map-data-2026-11',
    );
  });
});
