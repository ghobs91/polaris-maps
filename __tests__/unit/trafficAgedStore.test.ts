import {
  AgedTrafficStore,
  AGED_MAX_AGE_SEC,
  AGED_MAX_ROWS,
  AGED_RETENTION_SEC,
  InMemoryAgedTrafficBackend,
  agedCellForSegment,
  agedRowsFromSegments,
  agedSegmentsFromRows,
} from '../../src/services/traffic/trafficAgedStore';
import { encode as geohashEncode } from '../../src/utils/geohash';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

const NOW = 1_800_000_000;
const CELL = geohashEncode(40.7, -74.0, 5);
const OTHER_CELL = geohashEncode(40.8, -74.1, 5);

const POINTS: Record<string, { lat: number; lng: number }> = {
  [CELL]: { lat: 40.7, lng: -74.0 },
  [OTHER_CELL]: { lat: 40.8, lng: -74.1 },
};

function segment(
  cell: string,
  overrides: Partial<NormalizedTrafficSegment> = {},
): NormalizedTrafficSegment {
  const point = POINTS[cell] ?? POINTS[CELL];
  return {
    id: `tomtom:${cell}`,
    coordinates: [[point.lng, point.lat]],
    currentSpeedMph: 30,
    freeFlowSpeedMph: 60,
    congestionRatio: 0.5,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: NOW - 60,
    ...overrides,
  };
}

function makeStore(overrides: { now?: () => number } = {}) {
  const backend = new InMemoryAgedTrafficBackend();
  const store = new AgedTrafficStore({ backend, now: overrides.now ?? (() => NOW) });
  return { store, backend };
}

describe('agedCellForSegment', () => {
  it('uses the geohash5 cell of the first coordinate', () => {
    expect(agedCellForSegment(segment(CELL))).toBe(CELL);
  });

  it('returns null for a segment without geometry', () => {
    expect(agedCellForSegment(segment(CELL, { coordinates: [] }))).toBeNull();
  });
});

describe('agedRowsFromSegments', () => {
  it('keeps the provider observation time instead of the write time', () => {
    const rows = agedRowsFromSegments([segment(CELL, { timestamp: NOW - 1200 })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].observedAt).toBe(NOW - 1200);
  });

  it('falls back to now when a segment carries no usable timestamp', () => {
    const rows = agedRowsFromSegments([segment(CELL, { timestamp: NaN })], NOW);
    expect(rows[0].observedAt).toBe(NOW);
  });

  it('clamps the ratio and drops non-finite or empty segments', () => {
    const rows = agedRowsFromSegments(
      [
        segment(CELL, { congestionRatio: 1.8 }),
        segment(OTHER_CELL, { congestionRatio: NaN }),
        segment('nogeom', { coordinates: [] }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].congestionRatio).toBe(1);
  });
});

describe('AgedTrafficStore', () => {
  it('returns recorded segments for their cell', async () => {
    const { store } = makeStore();
    await store.recordSegments([segment(CELL), segment(OTHER_CELL)]);

    const segments = await store.getSegments([CELL]);
    expect(segments.map((s) => s.id)).toEqual([`tomtom:${CELL}`]);
    expect(segments[0].congestionRatio).toBe(0.5);
    expect(segments[0].source).toBe('tomtom');
  });

  it('serves nothing for cells it never saw', async () => {
    const { store } = makeStore();
    await store.recordSegments([segment(CELL)]);
    expect(await store.getSegments([OTHER_CELL])).toEqual([]);
    expect(await store.getSegments([])).toEqual([]);
  });

  it('ages segments out of the served set but keeps them until retention', async () => {
    let now = NOW;
    const { store } = makeStore({ now: () => now });
    await store.recordSegments([segment(CELL, { timestamp: NOW })]);

    now = NOW + AGED_MAX_AGE_SEC - 1;
    expect(await store.getSegments([CELL])).toHaveLength(1);

    now = NOW + AGED_MAX_AGE_SEC + 1;
    expect(await store.getSegments([CELL])).toEqual([]);
    // Still retained: a longer-lived fallback is allowed, it just cannot answer.
    expect(await store.count()).toBe(1);
  });

  it('prunes past the retention window and reports the rows removed', async () => {
    let now = NOW;
    const { store } = makeStore({ now: () => now });
    await store.recordSegments([segment(CELL), segment(OTHER_CELL)]);

    now = NOW + AGED_RETENTION_SEC + 1;
    expect(await store.prune()).toBe(2);
    expect(await store.count()).toBe(0);
  });

  it('keeps the newest copy when the same segment is recorded again', async () => {
    let now = NOW;
    const { store } = makeStore({ now: () => now });
    await store.recordSegments([segment(CELL, { timestamp: NOW - 300, congestionRatio: 0.2 })]);
    await store.recordSegments([segment(CELL, { timestamp: NOW - 10, congestionRatio: 0.9 })]);

    const [newest] = await store.getSegments([CELL]);
    expect(newest.congestionRatio).toBe(0.9);

    // An older copy must not overwrite a newer one.
    await store.recordSegments([segment(CELL, { timestamp: NOW - 600, congestionRatio: 0.1 })]);
    const [stillNewest] = await store.getSegments([CELL]);
    expect(stillNewest.congestionRatio).toBe(0.9);
    expect(await store.count()).toBe(1);
  });

  it('trims the table to the row cap', async () => {
    const backend = new InMemoryAgedTrafficBackend();
    const store = new AgedTrafficStore({ backend, now: () => NOW, maxRows: 2 });
    await store.recordSegments([
      segment(CELL, { id: 'a', timestamp: NOW - 30 }),
      segment(CELL, { id: 'b', timestamp: NOW - 20 }),
      segment(CELL, { id: 'c', timestamp: NOW - 10 }),
    ]);

    expect(await store.count()).toBe(3);
    await store.prune();
    expect(await store.count()).toBe(2);

    const kept = (await store.getSegments([CELL])).map((s) => s.id).sort();
    expect(kept).toEqual(['b', 'c']);
  });

  it('round-trips through the segment conversion helpers', () => {
    const rows = agedRowsFromSegments([segment(CELL)], NOW);
    const [restored] = agedSegmentsFromRows(rows);
    expect(restored).toEqual(segment(CELL));
  });

  it('exposes the documented defaults', () => {
    expect(AGED_MAX_AGE_SEC).toBe(2 * 60 * 60);
    expect(AGED_RETENTION_SEC).toBe(6 * 60 * 60);
    expect(AGED_MAX_ROWS).toBe(20_000);
  });
});
