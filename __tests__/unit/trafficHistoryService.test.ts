import {
  TrafficHistoryService,
  mergeConditionObservation,
} from '../../src/services/traffic/trafficHistoryService';
import { InMemoryTrafficHistoryBackend } from '../../src/services/traffic/trafficHistoryInMemory';
import type { TrafficAreaCondition } from '../../src/models/trafficHistory';

const BUCKET = { dayOfWeek: 3, halfHour: 30 }; // Wed 15:00
const CELL = '9q8yy';

function makeHistory(
  overrides: Partial<ConstructorParameters<typeof TrafficHistoryService>[0]> = {},
) {
  const backend = new InMemoryTrafficHistoryBackend();
  const now = { value: 1_800_000_000 }; // mutable fake clock (epoch seconds)
  const service = new TrafficHistoryService({
    backend,
    now: () => now.value,
    ...overrides,
  });
  return { backend, service, now };
}

describe('mergeConditionObservation', () => {
  const existing: TrafficAreaCondition = {
    geohash5: CELL,
    dayOfWeek: 3,
    halfHour: 30,
    avgSpeedMph: 40,
    avgCongestionRatio: 0.8,
    freeFlowSpeedMph: 50,
    sampleCount: 10,
    probeSamples: 8,
    lastUpdated: 1000,
  };

  it('EMA-blends speed and ratio with the configured alpha', () => {
    const merged = mergeConditionObservation(
      existing,
      { avgSpeedMph: 20, avgCongestionRatio: 0.4, freeFlowSpeedMph: 50 },
      2000,
      0.5,
    );
    expect(merged.avgSpeedMph).toBeCloseTo(30, 1);
    expect(merged.avgCongestionRatio).toBeCloseTo(0.6, 1);
    expect(merged.sampleCount).toBe(11);
    expect(merged.lastUpdated).toBe(2000);
  });

  it('keeps the max free-flow speed', () => {
    const merged = mergeConditionObservation(
      existing,
      { avgSpeedMph: 40, avgCongestionRatio: 0.8, freeFlowSpeedMph: 65 },
      2000,
      0.35,
    );
    expect(merged.freeFlowSpeedMph).toBe(65);
  });

  it('caps sample count at MAX_SAMPLE_COUNT', () => {
    const merged = mergeConditionObservation(
      { ...existing, sampleCount: 200 },
      { avgSpeedMph: 40, avgCongestionRatio: 0.8, freeFlowSpeedMph: 50 },
      2000,
      0.35,
    );
    expect(merged.sampleCount).toBe(200);
  });
});

describe('TrafficHistoryService.recordObservation', () => {
  it('inserts a new row with sampleCount 1', async () => {
    const { service } = makeHistory();
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 42.5,
      avgCongestionRatio: 0.7,
      freeFlowSpeedMph: 55,
    });
    const rows = await service.getFresh([CELL], BUCKET);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      geohash5: CELL,
      sampleCount: 1,
      avgSpeedMph: 42.5,
    });
  });

  it('EMA-merges repeated observations for the same cell + bucket', async () => {
    const { service } = makeHistory({ emaAlpha: 0.5 });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 20,
      avgCongestionRatio: 0.4,
      freeFlowSpeedMph: 50,
    });
    const rows = await service.getFresh([CELL], BUCKET);
    expect(rows).toHaveLength(1);
    expect(rows[0].avgSpeedMph).toBeCloseTo(30, 1);
    expect(rows[0].sampleCount).toBe(2);
  });

  it('does not mix different time buckets', async () => {
    const { service } = makeHistory();
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    const other = { dayOfWeek: 3, halfHour: 31 };
    const rows = await service.getFresh([CELL], other);
    expect(rows).toHaveLength(0);
  });
});

describe('fresh vs historical queries', () => {
  it('getFresh only returns rows observed within the fresh window', async () => {
    const { service, now } = makeHistory({ freshSec: 900 });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    // Now + 14 minutes: still fresh
    now.value += 14 * 60;
    expect(await service.getFresh([CELL], BUCKET)).toHaveLength(1);
    // Now + 16 more minutes (30 total): stale
    now.value += 16 * 60;
    expect(await service.getFresh([CELL], BUCKET)).toHaveLength(0);
  });

  it('getHistorical requires the minimum sample count', async () => {
    const { service } = makeHistory({ minHistoricalSamples: 3 });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    expect(await service.getHistorical([CELL], BUCKET)).toHaveLength(0);

    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    expect(await service.getHistorical([CELL], BUCKET)).toHaveLength(1);
  });

  it('getHistorical excludes rows older than the retention window', async () => {
    const { service, now } = makeHistory({ historicalMaxAgeDays: 21, minHistoricalSamples: 1 });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    now.value += 22 * 86_400; // 22 days later
    expect(await service.getHistorical([CELL], BUCKET)).toHaveLength(0);
  });
});

describe('prune', () => {
  it('removes rows older than the retention window', async () => {
    const { service, now } = makeHistory({ historicalMaxAgeDays: 21 });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
    });
    await service.recordObservation(
      { dayOfWeek: 4, halfHour: 0 },
      {
        geohash5: 'other',
        avgSpeedMph: 40,
        avgCongestionRatio: 0.8,
        freeFlowSpeedMph: 50,
      },
    );
    now.value += 22 * 86_400;
    expect(await service.prune()).toBe(2);
    expect(await service.count()).toBe(0);
  });
});

describe('probe-sample provenance', () => {
  it('counts probe/p2p/nostr sources toward probeSamples when inserting', async () => {
    const { service } = makeHistory();
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
      source: 'probe',
    });
    await service.recordObservation(BUCKET, {
      geohash5: '9q8yz',
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
      source: 'p2p',
    });
    await service.recordObservation(BUCKET, {
      geohash5: '9q8za',
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
      source: 'nostr',
    });
    const all = await service.getHistorical([CELL, '9q8yz', '9q8za'], BUCKET);
    expect(all.every((r) => r.probeSamples === 1)).toBe(true);
  });

  it('does not count tomtom/open_feed sources toward probeSamples', async () => {
    const { service } = makeHistory();
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
      source: 'tomtom',
    });
    await service.recordObservation(BUCKET, {
      geohash5: '9q8yz',
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
      source: 'open_feed',
    });
    await service.recordObservation(BUCKET, {
      geohash5: '9q8zb',
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
    });
    const all = await service.getHistorical([CELL, '9q8yz', '9q8zb'], BUCKET);
    expect(all.every((r) => r.probeSamples === 0)).toBe(true);
  });

  it('increments probeSamples on merge only for probe-derived sources', async () => {
    const { service } = makeHistory();
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 30,
      avgCongestionRatio: 0.6,
      freeFlowSpeedMph: 50,
      source: 'tomtom',
    });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 32,
      avgCongestionRatio: 0.62,
      freeFlowSpeedMph: 50,
      source: 'probe',
    });
    await service.recordObservation(BUCKET, {
      geohash5: CELL,
      avgSpeedMph: 31,
      avgCongestionRatio: 0.61,
      freeFlowSpeedMph: 50,
      source: 'tomtom',
    });
    const rows = await service.getHistorical([CELL], BUCKET);
    expect(rows[0]!.sampleCount).toBe(3);
    expect(rows[0]!.probeSamples).toBe(1);
  });

  it('treats legacy rows without probeSamples as 0 (never NaN)', () => {
    const legacy = {
      geohash5: CELL,
      dayOfWeek: 3,
      halfHour: 30,
      avgSpeedMph: 40,
      avgCongestionRatio: 0.8,
      freeFlowSpeedMph: 50,
      sampleCount: 10,
      lastUpdated: 1000,
    } as unknown as TrafficAreaCondition;
    const merged = mergeConditionObservation(
      legacy,
      { avgSpeedMph: 20, avgCongestionRatio: 0.4, freeFlowSpeedMph: 50 },
      2000,
      0.35,
      true,
    );
    expect(merged.probeSamples).toBe(1);
  });
});

describe('holiday buckets', () => {
  // A Friday 23:30 bucket on Christmas Eve 2026 vs a regular Friday 23:30.
  const HOLIDAY_BUCKET = { dayOfWeek: 5, halfHour: 47, holiday: true };
  const REGULAR_BUCKET = { dayOfWeek: 5, halfHour: 47 };

  const obs = {
    geohash5: CELL,
    avgSpeedMph: 12,
    avgCongestionRatio: 0.2,
    freeFlowSpeedMph: 55,
  };

  it('records holiday observations outside the regular weekly profile', async () => {
    const { service } = makeHistory();
    await service.recordObservation(HOLIDAY_BUCKET, obs);

    // The holiday row must not answer a regular Friday query…
    expect(await service.getFresh([CELL], REGULAR_BUCKET)).toHaveLength(0);
    // …and a regular observation must not answer a holiday query.
    await service.recordObservation(REGULAR_BUCKET, {
      geohash5: 'otherCell',
      avgSpeedMph: 45,
      avgCongestionRatio: 0.9,
      freeFlowSpeedMph: 55,
    });
    expect(await service.getFresh([CELL], HOLIDAY_BUCKET)).toHaveLength(1);
    expect(await service.getFresh(['otherCell'], HOLIDAY_BUCKET)).toHaveLength(0);
  });

  it('serves a holiday row after a single observation', async () => {
    const { service } = makeHistory({ minHistoricalSamples: 3 });
    await service.recordObservation(HOLIDAY_BUCKET, obs);

    // One sample suffices: the next chance to observe the same holiday
    // bucket is a year away, and the deviation is the point of the key.
    const rows = await service.getHistorical([CELL], HOLIDAY_BUCKET);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sampleCount: 1, holiday: true });
  });

  it('falls back to the regular weekly profile for cells without holiday data', async () => {
    const { service } = makeHistory({ minHistoricalSamples: 3 });
    await service.recordObservation(HOLIDAY_BUCKET, { ...obs, geohash5: CELL });
    await service.recordObservation(REGULAR_BUCKET, {
      ...obs,
      geohash5: 'otherCell',
      avgSpeedMph: 45,
      avgCongestionRatio: 0.9,
    });
    await service.recordObservation(REGULAR_BUCKET, {
      ...obs,
      geohash5: 'otherCell',
      avgSpeedMph: 45,
      avgCongestionRatio: 0.9,
    });
    await service.recordObservation(REGULAR_BUCKET, {
      ...obs,
      geohash5: 'otherCell',
      avgSpeedMph: 45,
      avgCongestionRatio: 0.9,
    });

    const rows = await service.getHistorical([CELL, 'otherCell'], HOLIDAY_BUCKET);
    // CELL answered from the holiday table, otherCell from the regular one.
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.geohash5 === CELL)).toMatchObject({ holiday: true });
    expect(rows.find((r) => r.geohash5 === 'otherCell')?.holiday).toBeFalsy();
  });

  it('keeps holiday rows beyond the regular one-month window', async () => {
    const { service, now } = makeHistory({ minHistoricalSamples: 1 });
    await service.recordObservation(HOLIDAY_BUCKET, obs);

    now.value += 60 * 86_400; // two months later — past the regular window
    // Next year's same holiday is 366 days out; last year's row still answers.
    expect(await service.getHistorical([CELL], HOLIDAY_BUCKET)).toHaveLength(1);
  });

  it('does not serve holiday rows to a regular-day query', async () => {
    const { service } = makeHistory({ minHistoricalSamples: 1 });
    await service.recordObservation(HOLIDAY_BUCKET, obs);
    expect(await service.getHistorical([CELL], REGULAR_BUCKET)).toHaveLength(0);
  });

  it('prunes holiday rows on the holiday window, regular rows on theirs', async () => {
    const { service, now } = makeHistory({ minHistoricalSamples: 1 });
    await service.recordObservation(HOLIDAY_BUCKET, obs);
    await service.recordObservation(REGULAR_BUCKET, { ...obs, geohash5: 'otherCell' });

    now.value += 60 * 86_400; // two months: regular rows expired, holiday not
    expect(await service.prune()).toBe(1);
    expect(await service.count()).toBe(1);
    expect(await service.getHistorical([CELL], HOLIDAY_BUCKET)).toHaveLength(1);

    now.value += 400 * 86_400; // past the holiday window too
    expect(await service.prune()).toBe(1);
    expect(await service.count()).toBe(0);
  });
});
