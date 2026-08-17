import {
  resolveTrafficConditions,
  observationsFromSegments,
  segmentsFromConditions,
} from '../../src/services/traffic/trafficCascade';
import { TrafficHistoryService } from '../../src/services/traffic/trafficHistoryService';
import { InMemoryTrafficHistoryBackend } from '../../src/services/traffic/trafficHistoryInMemory';
import { conditionToWire } from '../../src/services/traffic/p2pConditionWire';
import { encode as geohashEncode } from '../../src/utils/geohash';
import type { TrafficAreaCondition } from '../../src/models/trafficHistory';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

const BUCKET = { dayOfWeek: 3, halfHour: 30 };
const POINTS = [
  { lat: 40.7, lng: -74.0, cell: geohashEncode(40.7, -74.0, 5) },
  { lat: 40.75, lng: -74.05, cell: geohashEncode(40.75, -74.05, 5) },
  { lat: 40.8, lng: -74.1, cell: geohashEncode(40.8, -74.1, 5) },
];
const CELLS = POINTS.map((p) => p.cell);

function makeCondition(
  cell: string,
  overrides: Partial<TrafficAreaCondition> = {},
): TrafficAreaCondition {
  return {
    geohash5: cell,
    dayOfWeek: BUCKET.dayOfWeek,
    halfHour: BUCKET.halfHour,
    avgSpeedMph: 40,
    avgCongestionRatio: 0.8,
    freeFlowSpeedMph: 50,
    sampleCount: 5,
    lastUpdated: 1_800_000_000,
    ...overrides,
  };
}

function makeTomTomSegment(cell: string, ratio: number): NormalizedTrafficSegment {
  const point = POINTS.find((p) => p.cell === cell) ?? POINTS[0];
  return {
    id: `tomtom:${cell}`,
    coordinates: [[point.lng, point.lat]],
    currentSpeedMph: 50 * ratio,
    freeFlowSpeedMph: 50,
    congestionRatio: ratio,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: 1_800_000_000,
  };
}

function makeHistory(rows: TrafficAreaCondition[] = []) {
  const backend = new InMemoryTrafficHistoryBackend();
  const history = new TrafficHistoryService({
    backend,
    now: () => 1_800_000_000,
  });
  for (const row of rows) {
    void backend.insert(row);
  }
  return history;
}

describe('resolveTrafficConditions cascade order', () => {
  it('uses local fresh data without touching P2P or TomTom', async () => {
    const history = makeHistory(CELLS.map((c) => makeCondition(c, { lastUpdated: 1_800_000_000 })));
    const seed = jest.fn(async () => []);
    const p2p = jest.fn(async () => []);

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: seed,
      indexObservations: async () => {},
      p2pQuery: p2p,
    });

    expect(result.source).toBe('local-fresh');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(result.segments).toHaveLength(3);
    expect(p2p).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
  });

  it('falls back to local historical averages when fresh is stale', async () => {
    const history = makeHistory(
      CELLS.map((c) => makeCondition(c, { lastUpdated: 1_799_000_000, sampleCount: 4 })),
    );
    const seed = jest.fn(async () => []);

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: seed,
      indexObservations: async () => {},
      p2pQuery: async () => [],
    });

    expect(result.source).toBe('local-history');
    expect(result.segments).toHaveLength(3);
    expect(seed).not.toHaveBeenCalled();
  });

  it('uses P2P responses for cells missing locally and indexes them', async () => {
    const history = makeHistory();
    const seed = jest.fn(async () => []);
    const wireEntries = CELLS.map((c, i) =>
      conditionToWire(makeCondition(c, { avgSpeedMph: 30 + i, lastUpdated: 1_800_000_000 }), true),
    );

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: seed,
      indexObservations: async () => {},
      p2pQuery: async () => wireEntries,
    });

    expect(result.source).toBe('p2p');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(seed).not.toHaveBeenCalled();

    // P2P entries must have been written into the local index
    const fresh = await history.getFresh(CELLS, BUCKET);
    expect(fresh).toHaveLength(3);
  });

  it('seeds from TomTom only for cells still missing after all tiers', async () => {
    // cellA resolvable locally, cellB/C must hit TomTom
    const history = makeHistory([makeCondition(CELLS[0], { lastUpdated: 1_800_000_000 })]);
    const seededCells: string[][] = [];
    const seed = jest.fn(async (cells: string[]) => {
      seededCells.push(cells);
      return cells.map((c) => makeTomTomSegment(c, 0.5));
    });
    const indexedCells: string[][] = [];
    const indexObservations = jest.fn(async (_b: unknown, obs: { geohash5: string }[]) => {
      indexedCells.push(obs.map((o) => o.geohash5));
    });

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: seed,
      indexObservations,
      p2pQuery: async () => [],
    });

    expect(seed).toHaveBeenCalledTimes(1);
    expect(seededCells[0].sort()).toEqual([CELLS[1], CELLS[2]].sort());
    expect(indexObservations).toHaveBeenCalledTimes(1);
    expect(indexedCells[0].sort()).toEqual([CELLS[1], CELLS[2]].sort());
    expect(result.source).toBe('tomtom');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(result.segments).toHaveLength(3);
    // TomTom-seeded segments carry the history source with tomtom confidence
    expect(result.segments.every((s) => s.source === 'history')).toBe(true);
  });

  it('reports unresolved cells when no tier has data', async () => {
    const history = makeHistory();
    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: async () => [],
      indexObservations: async () => {},
      p2pQuery: async () => [],
    });
    expect(result.source).toBe('none');
    expect(result.unresolvedCells.sort()).toEqual([...CELLS].sort());
    expect(result.segments).toHaveLength(0);
  });

  it('mixes tiers per cell: fresh local + p2p + tomtom', async () => {
    const history = makeHistory([makeCondition(CELLS[0], { lastUpdated: 1_800_000_000 })]);
    const seed = jest.fn(async (cells: string[]) => cells.map((c) => makeTomTomSegment(c, 0.3)));
    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: seed,
      indexObservations: async () => {},
      p2pQuery: async (cells) =>
        cells.includes(CELLS[1])
          ? [conditionToWire(makeCondition(CELLS[1], { lastUpdated: 1_800_000_000 }), true)]
          : [],
    });

    expect(result.unresolvedCells).toHaveLength(0);
    // Only the third cell should reach TomTom
    expect(seed).toHaveBeenCalledWith([CELLS[2]]);
    expect(result.source).toBe('tomtom');
  });
});

describe('observationsFromSegments', () => {
  it('aggregates per cell with confidence weighting', () => {
    const obs = observationsFromSegments(
      [makeTomTomSegment(CELLS[0], 0.9), makeTomTomSegment(CELLS[0], 0.5)],
      (lng, lat) => geohashEncode(lat, lng, 5),
    );
    expect(obs.size).toBe(1);
    const o = obs.get(CELLS[0]);
    expect(o).toBeDefined();
    // Equal weights: mean of 0.9 and 0.5 = 0.7
    expect(o!.avgCongestionRatio).toBeCloseTo(0.7, 5);
    expect(o!.freeFlowSpeedMph).toBe(50);
  });
});

describe('segmentsFromConditions', () => {
  it('synthesizes one segment per covered point with history source', () => {
    const conditions = new Map(CELLS.map((c) => [c, makeCondition(c)]));
    const segments = segmentsFromConditions(POINTS, conditions, BUCKET, 'local-fresh');
    expect(segments).toHaveLength(3);
    expect(segments[0].source).toBe('history');
    expect(segments[0].congestionRatio).toBe(0.8);
    expect(segments[0].coordinates[0]).toEqual([-74.0, 40.7]);
  });

  it('skips points whose cell has no condition', () => {
    const conditions = new Map([[CELLS[0], makeCondition(CELLS[0])]]);
    const segments = segmentsFromConditions(POINTS, conditions, BUCKET, 'p2p');
    expect(segments).toHaveLength(1);
  });
});
