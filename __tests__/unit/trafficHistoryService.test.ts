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
