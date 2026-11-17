/**
 * Saved upstream flow — the store that makes a repeat request free.
 *
 * The rule: flow this device already saw for a weekday + hour block answers
 * later requests in that same block (up to a month), so TomTom is only asked
 * when nothing is saved for the block. These tests pin the bucket key, the
 * granularity matching, and the age limit.
 */

import {
  InMemorySavedFlowBackend,
  SavedFlowStore,
  savedFlowCellForSegment,
  savedFlowRowsFromSegments,
  savedFlowSegmentsFromRows,
} from '../../src/services/traffic/trafficSavedFlowStore';
import {
  currentSavedFlowBucket,
  savedFlowBucketFor,
  savedFlowBucketFromHalfHour,
  savedFlowBucketKey,
} from '../../src/services/traffic/savedFlowBucket';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';
import { encode as geohashEncode } from '../../src/utils/geohash';

const CELL = geohashEncode(40.7, -74.0, 5);
const NOW = 1_800_000_000; // fixed clock (epoch seconds)
const TUESDAY_1500 = { dayOfWeek: 2, hour: 15 };

function seg(overrides: Partial<NormalizedTrafficSegment> = {}): NormalizedTrafficSegment {
  return {
    id: 'tomtom:a',
    coordinates: [[-74.0, 40.7]],
    currentSpeedMph: 20,
    freeFlowSpeedMph: 40,
    congestionRatio: 0.5,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: NOW,
    ...overrides,
  };
}

function makeStore(overrides: { now?: number } = {}) {
  const backend = new InMemorySavedFlowBackend();
  const clock = { value: overrides.now ?? NOW };
  const store = new SavedFlowStore({ backend, now: () => clock.value });
  return { backend, store, clock };
}

describe('savedFlowBucket', () => {
  it('keys a timestamp by local weekday and hour', () => {
    // Tuesday 15:20 local.
    const tuesday = new Date(2026, 1, 3, 15, 20, 0);
    expect(savedFlowBucketFor(tuesday)).toEqual({ dayOfWeek: 2, hour: 15 });
    expect(savedFlowBucketKey(savedFlowBucketFor(tuesday))).toBe('2:15');
  });

  it('rounds a 30-minute index bucket down to its hour', () => {
    // 15:30–15:59 (halfHour 31) still belongs to the 15:00 block.
    expect(savedFlowBucketFromHalfHour(2, 31)).toEqual({ dayOfWeek: 2, hour: 15 });
    expect(savedFlowBucketFromHalfHour(2, 30)).toEqual({ dayOfWeek: 2, hour: 15 });
    expect(savedFlowBucketFromHalfHour(2, 47)).toEqual({ dayOfWeek: 2, hour: 23 });
  });

  it('derives the current bucket from the clock', () => {
    const now = new Date(2026, 1, 3, 9, 5, 0).getTime();
    expect(currentSavedFlowBucket(now)).toEqual({ dayOfWeek: 2, hour: 9 });
  });
});

describe('SavedFlowStore', () => {
  it('answers a request in the same weekday + hour bucket', async () => {
    const { store } = makeStore();
    await store.recordSegments([seg()], TUESDAY_1500, 'segment');

    const got = await store.getSegments([CELL], TUESDAY_1500, ['segment']);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ congestionRatio: 0.5, source: 'tomtom' });
  });

  it('does not answer a request for a different hour or weekday', async () => {
    const { store } = makeStore();
    await store.recordSegments([seg()], TUESDAY_1500, 'segment');

    expect(await store.getSegments([CELL], { dayOfWeek: 2, hour: 16 }, ['segment'])).toHaveLength(
      0,
    );
    expect(await store.getSegments([CELL], { dayOfWeek: 3, hour: 15 }, ['segment'])).toHaveLength(
      0,
    );
  });

  it('never answers a road-segment request with tile point-samples', async () => {
    const { store } = makeStore();
    await store.recordSegments([seg({ id: 'tile:1' })], TUESDAY_1500, 'tile');

    // A request that needs road segments cannot use tile samples…
    expect(await store.getSegments([CELL], TUESDAY_1500, ['segment'])).toHaveLength(0);
    // …while a request that accepts either granularity can.
    expect(await store.getSegments([CELL], TUESDAY_1500, ['segment', 'tile'])).toHaveLength(1);
  });

  it('serves a bucket for a month and stops after that', async () => {
    const { store, clock } = makeStore();
    await store.recordSegments([seg()], TUESDAY_1500, 'segment');

    clock.value = NOW + 30 * 86_400; // 30 days later: still saved data
    expect(await store.getSegments([CELL], TUESDAY_1500, ['segment'])).toHaveLength(1);

    clock.value = NOW + 32 * 86_400; // past the month
    expect(await store.getSegments([CELL], TUESDAY_1500, ['segment'])).toHaveLength(0);
  });

  it('keeps the provider observation time, not the write time', async () => {
    const { store, clock } = makeStore();
    const observedAt = NOW - 5 * 86_400;
    await store.recordSegments([seg({ timestamp: observedAt })], TUESDAY_1500, 'segment');

    const [row] = await store.getSegments([CELL], TUESDAY_1500, ['segment']);
    expect(row?.timestamp).toBe(observedAt);

    // Re-saving the same observation later must not reset its age.
    clock.value = NOW + 10 * 86_400;
    expect(await store.getSegments([CELL], TUESDAY_1500, ['segment'])).toHaveLength(1);
    clock.value = NOW + 34 * 86_400;
    expect(await store.getSegments([CELL], TUESDAY_1500, ['segment'])).toHaveLength(0);
  });

  it('reports which cells a bucket already covers', async () => {
    const { store } = makeStore();
    await store.recordSegments([seg()], TUESDAY_1500, 'segment');

    const covered = await store.coveredCells([CELL, 'other'], TUESDAY_1500, ['segment']);
    expect([...covered]).toEqual([CELL]);
  });

  it('prunes past retention and enforces the row cap', async () => {
    const { store, clock } = makeStore();
    await store.recordSegments([seg(), seg({ id: 'tomtom:b' })], TUESDAY_1500, 'segment');
    expect(await store.count()).toBe(2);

    clock.value = NOW + 60 * 86_400;
    expect(await store.prune()).toBe(2);
    expect(await store.count()).toBe(0);
  });
});

describe('saved flow row conversion', () => {
  it('keys rows by the cell of the first coordinate', () => {
    expect(savedFlowCellForSegment(seg())).toBe(CELL);
    expect(savedFlowCellForSegment(seg({ coordinates: [] }))).toBeNull();
  });

  it('drops segments without usable geometry instead of failing', () => {
    const rows = savedFlowRowsFromSegments(
      [seg(), seg({ coordinates: [], id: 'bad' })],
      TUESDAY_1500,
      'segment',
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cell: CELL, dayOfWeek: 2, hour: 15, kind: 'segment' });
  });

  it('round-trips rows back into segments', () => {
    const [row] = savedFlowRowsFromSegments([seg()], TUESDAY_1500, 'tile', NOW);
    const [back] = savedFlowSegmentsFromRows([row!]);
    expect(back).toMatchObject({
      id: 'tomtom:a',
      congestionRatio: 0.5,
      currentSpeedMph: 20,
      source: 'tomtom',
    });
  });
});
