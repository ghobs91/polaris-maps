import {
  resolveTrafficConditions,
  observationsFromSegments,
  segmentsFromConditions,
} from '../../src/services/traffic/trafficCascade';
import { TrafficHistoryService } from '../../src/services/traffic/trafficHistoryService';
import { InMemoryTrafficHistoryBackend } from '../../src/services/traffic/trafficHistoryInMemory';
import { conditionToWire } from '../../src/services/traffic/p2pConditionWire';
import { getTomTomRequestsUsed, noteTomTomRequest } from '../../src/services/traffic/tomtomAccess';
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
    probeSamples: 5,
    observedSpanDays: 2,
    lastObservedDay: 20_833,
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
      p2pQuery: p2p,
    });

    expect(result.source).toBe('local-fresh');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(result.segments).toHaveLength(3);
    expect(result.breakdown).toEqual({
      requestedCells: 3,
      localProbe: 3,
      localSeeded: 0,
      p2p: 0,
      openFeed: 0,
      savedFlow: 0,
      coldStart: 0,
      unresolved: 0,
      providerRequests: 0,
    });
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
      p2pQuery: async () => [],
    });

    expect(result.source).toBe('local-history');
    expect(result.segments).toHaveLength(3);
    expect(seed).not.toHaveBeenCalled();
  });

  it('flags local rows with no probe samples as seeded, not on-device', async () => {
    const history = makeHistory(
      CELLS.map((c) => makeCondition(c, { probeSamples: 0, sampleCount: 1 })),
    );
    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: async () => [],
      p2pQuery: async () => [],
    });

    // Rows written before the index stopped accepting upstream observations
    // must not be reported as on-device history.
    expect(result.breakdown.localProbe).toBe(0);
    expect(result.breakdown.localSeeded).toBe(3);
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
      p2pQuery: async () => wireEntries,
    });

    expect(result.source).toBe('p2p');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(result.breakdown.p2p).toBe(3);
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
      p2pQuery: async () => [],
    });

    expect(seed).toHaveBeenCalledTimes(1);
    expect(seededCells[0].sort()).toEqual([CELLS[1], CELLS[2]].sort());
    expect(indexObservations).not.toHaveBeenCalled();
    expect(indexedCells).toHaveLength(0);
    // One cell came from the on-device index, so local outranks the bridge.
    expect(result.source).toBe('local-fresh');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(result.segments).toHaveLength(3);
    expect(result.breakdown).toMatchObject({ localProbe: 1, coldStart: 2, unresolved: 0 });
    // TomTom-seeded segments carry the history source with tomtom confidence
    expect(result.segments.every((s) => s.source === 'history')).toBe(true);
    // The seed is cached by the caller, not blended into the weekly probe
    // index — otherwise a cold-start answer would later be reported as
    // on-device history.
    expect(await history.getFresh([CELLS[1], CELLS[2]], BUCKET)).toHaveLength(0);
    expect(await history.count()).toBe(1);
  });

  it('reports unresolved cells when no tier has data', async () => {
    const history = makeHistory();
    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: async () => [],
      p2pQuery: async () => [],
    });
    expect(result.source).toBe('none');
    expect(result.unresolvedCells.sort()).toEqual([...CELLS].sort());
    expect(result.segments).toHaveLength(0);
    expect(result.breakdown).toMatchObject({ requestedCells: 3, unresolved: 3 });
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
      p2pQuery: async (cells) =>
        cells.includes(CELLS[1])
          ? [conditionToWire(makeCondition(CELLS[1], { lastUpdated: 1_800_000_000 }), true)]
          : [],
    });

    expect(result.unresolvedCells).toHaveLength(0);
    // Only the third cell should reach TomTom
    expect(seed).toHaveBeenCalledWith([CELLS[2]]);
    // The label names the most authoritative tier that answered, not the last
    // one that ran — the per-cell split is in the breakdown.
    expect(result.source).toBe('local-fresh');
    expect(result.breakdown).toMatchObject({ localProbe: 1, p2p: 1, coldStart: 1 });
  });

  it('uses the open feed before TomTom and skips TomTom when it resolves every cell', async () => {
    const history = makeHistory();
    const seed = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    const openFeed = jest.fn(async (cells: string[]) =>
      cells.map((c) => makeTomTomSegment(c, 0.5)),
    );

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      openFeed,
      seedFromTomTom: seed,
      p2pQuery: async () => [],
    });

    expect(openFeed).toHaveBeenCalledTimes(1);
    expect(seed).not.toHaveBeenCalled();
    expect(result.source).toBe('open_feed');
    expect(result.unresolvedCells).toHaveLength(0);
  });

  it('falls through to TomTom for cells the open feed does not resolve', async () => {
    const history = makeHistory();
    const openFeed = jest.fn(async (cells: string[]) =>
      cells.slice(0, 1).map((c) => makeTomTomSegment(c, 0.5)),
    );
    const seed = jest.fn(async (cells: string[]) => cells.map((c) => makeTomTomSegment(c, 0.5)));

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      openFeed,
      seedFromTomTom: seed,
      p2pQuery: async () => [],
    });

    expect(seed).toHaveBeenCalledWith([CELLS[1], CELLS[2]]);
    // Open feed outranks the paid bridge in the label.
    expect(result.source).toBe('open_feed');
    expect(result.breakdown).toMatchObject({ openFeed: 1, coldStart: 2 });
    expect(result.unresolvedCells).toHaveLength(0);
  });

  it('treats a failing open feed as no data and still reaches TomTom', async () => {
    const history = makeHistory();
    const openFeed = jest.fn(async () => {
      throw new Error('feed down');
    });
    const seed = jest.fn(async (cells: string[]) => cells.map((c) => makeTomTomSegment(c, 0.5)));

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      openFeed,
      seedFromTomTom: seed,
      p2pQuery: async () => [],
    });

    expect(result.source).toBe('tomtom');
    expect(result.unresolvedCells).toHaveLength(0);
  });

  it('answers from saved upstream flow before the provider is asked', async () => {
    // The device already fetched flow for this weekday + hour bucket: the
    // request must be answered locally and cost zero provider requests.
    const history = makeHistory();
    const savedFlow = jest.fn(async (cells: string[]) =>
      cells.map((c) => makeTomTomSegment(c, 0.4)),
    );
    const seed = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    const p2p = jest.fn(async () => []);

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      savedFlow,
      seedFromTomTom: seed,
      p2pQuery: p2p,
    });

    expect(savedFlow).toHaveBeenCalledWith(CELLS, BUCKET);
    expect(p2p).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
    expect(result.source).toBe('saved-flow');
    expect(result.breakdown.savedFlow).toBe(3);
    expect(result.breakdown.providerRequests).toBe(0);
    expect(result.unresolvedCells).toHaveLength(0);
    expect(result.segments).toHaveLength(3);
  });

  it('only asks saved flow for the cells local tiers missed', async () => {
    const history = makeHistory([makeCondition(CELLS[0], { lastUpdated: 1_800_000_000 })]);
    const savedFlow = jest.fn(async (cells: string[]) =>
      cells.map((c) => makeTomTomSegment(c, 0.4)),
    );

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      savedFlow,
      seedFromTomTom: async () => [],
      p2pQuery: async () => [],
    });

    expect(savedFlow).toHaveBeenCalledWith([CELLS[1], CELLS[2]], BUCKET);
    // On-device probe data outranks saved upstream flow.
    expect(result.source).toBe('local-fresh');
    expect(result.breakdown).toMatchObject({ localProbe: 1, savedFlow: 2, unresolved: 0 });
  });

  it('falls through to TomTom only for cells saved flow cannot answer', async () => {
    const history = makeHistory();
    const savedFlow = jest.fn(async (cells: string[]) =>
      cells.includes(CELLS[0]) ? [makeTomTomSegment(CELLS[0], 0.4)] : [],
    );
    const seed = jest.fn(async (cells: string[]) => cells.map((c) => makeTomTomSegment(c, 0.5)));

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      savedFlow,
      seedFromTomTom: seed,
      p2pQuery: async () => [],
    });

    expect(seed).toHaveBeenCalledWith([CELLS[1], CELLS[2]]);
    // Saved flow outranks the paid bridge, so it owns the label here.
    expect(result.source).toBe('saved-flow');
    expect(result.breakdown).toMatchObject({ savedFlow: 1, coldStart: 2, unresolved: 0 });
  });

  it('treats a failing saved-flow store as no data', async () => {
    const history = makeHistory();
    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      savedFlow: async () => {
        throw new Error('sqlite closed');
      },
      seedFromTomTom: async () => [],
      p2pQuery: async () => [],
    });

    expect(result.source).toBe('none');
    expect(result.breakdown.savedFlow).toBe(0);
    expect(result.unresolvedCells).toHaveLength(3);
  });

  it('reports how many provider requests the paid tier actually made', async () => {
    const history = makeHistory();
    const before = getTomTomRequestsUsed();
    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: BUCKET,
      points: POINTS,
      history,
      seedFromTomTom: async (cells) => {
        // Simulate the provider tier issuing one request per cell batch.
        noteTomTomRequest();
        return cells.map((c) => makeTomTomSegment(c, 0.5));
      },
      p2pQuery: async () => [],
    });

    expect(getTomTomRequestsUsed() - before).toBe(1);
    expect(result.breakdown.providerRequests).toBe(1);
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

  it('ignores ratio-only zero-speed segments when averaging speed', () => {
    const ratioOnly: NormalizedTrafficSegment = {
      ...makeTomTomSegment(CELLS[0], 0.2),
      currentSpeedMph: 0,
      freeFlowSpeedMph: 0,
      confidence: 0.8,
    };
    const measured: NormalizedTrafficSegment = {
      ...makeTomTomSegment(CELLS[0], 0.5),
      currentSpeedMph: 20,
      freeFlowSpeedMph: 40,
      confidence: 0.5,
      source: 'open_feed',
    };

    const o = observationsFromSegments([ratioOnly, measured], (lng, lat) =>
      geohashEncode(lat, lng, 5),
    ).get(CELLS[0]);

    // The 20 mph measurement must survive; averaging the 0 sentinel in would
    // have produced 20 * 0.5 / 1.3 ≈ 7.7 mph and a multi-hour ETA.
    expect(o!.avgSpeedMph).toBeCloseTo(20, 5);
    expect(o!.avgCongestionRatio).toBeCloseTo((0.2 * 0.8 + 0.5 * 0.5) / 1.3, 5);
    expect(o!.freeFlowSpeedMph).toBe(40);
  });

  it('reports zero speed when a cell only has ratio-only data', () => {
    const ratioOnly: NormalizedTrafficSegment = {
      ...makeTomTomSegment(CELLS[0], 0.4),
      currentSpeedMph: 0,
      freeFlowSpeedMph: 0,
    };

    const o = observationsFromSegments([ratioOnly], (lng, lat) => geohashEncode(lat, lng, 5)).get(
      CELLS[0],
    );

    expect(o!.avgSpeedMph).toBe(0);
    expect(o!.avgCongestionRatio).toBe(0.4);
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

  it('emits the cell ratio instead of a cell-average speed', () => {
    const conditions = new Map([
      [CELLS[0], makeCondition(CELLS[0], { avgSpeedMph: 12, freeFlowSpeedMph: 40 })],
    ]);

    const segments = segmentsFromConditions([POINTS[0]], conditions, BUCKET, 'local-fresh');

    // A ~5 km cell average must never be forwarded as a point speed: doing so
    // applies one jam to the entire cell's route segments.
    expect(segments[0].currentSpeedMph).toBe(0);
    expect(segments[0].congestionRatio).toBeCloseTo(0.8);
    expect(segments[0].freeFlowSpeedMph).toBe(40);
  });

  it('derives the ratio from speed and free flow when the cell has none', () => {
    const conditions = new Map([
      [
        CELLS[0],
        makeCondition(CELLS[0], {
          avgSpeedMph: 10,
          freeFlowSpeedMph: 40,
          avgCongestionRatio: 0,
        }),
      ],
    ]);

    const segments = segmentsFromConditions([POINTS[0]], conditions, BUCKET, 'p2p');

    expect(segments[0].currentSpeedMph).toBe(0);
    expect(segments[0].congestionRatio).toBeCloseTo(0.25);
  });

  it('skips points whose cell has no condition', () => {
    const conditions = new Map([[CELLS[0], makeCondition(CELLS[0])]]);
    const segments = segmentsFromConditions(POINTS, conditions, BUCKET, 'p2p');
    expect(segments).toHaveLength(1);
  });
});

describe('holiday buckets in the cascade', () => {
  // Same Friday 23:30 bucket, flagged as a major holiday (e.g. NYE).
  const HOLIDAY_BUCKET = { ...BUCKET, holiday: true };
  const HOLIDAY_POINTS = POINTS;

  it('answers a holiday request from the holiday table before TomTom', async () => {
    // Only the first cell has a holiday observation — one sample is enough.
    // Recorded an hour ago so tier 1 (fresh) does not answer first.
    const backend = new InMemoryTrafficHistoryBackend();
    const now = { value: 1_800_000_000 };
    const history = new TrafficHistoryService({ backend, now: () => now.value });
    await history.recordObservation(HOLIDAY_BUCKET, {
      geohash5: CELLS[0],
      avgSpeedMph: 20,
      avgCongestionRatio: 0.3,
      freeFlowSpeedMph: 50,
      source: 'probe',
    });
    now.value += 60 * 60;
    const seed = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    const p2p = jest.fn(async () => []);

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: HOLIDAY_BUCKET,
      points: HOLIDAY_POINTS,
      history,
      seedFromTomTom: seed,
      p2pQuery: p2p,
    });

    expect(result.source).toBe('local-history');
    // The two cells without saved data proceed down the tiers in order.
    expect(p2p).toHaveBeenCalledWith([CELLS[1], CELLS[2]], HOLIDAY_BUCKET);
    // TomTom is asked only for those same cells.
    expect(seed).toHaveBeenCalledWith([CELLS[1], CELLS[2]]);
  });

  it('answers a holiday request entirely from the regular weekly profile', async () => {
    // No holiday rows exist; the cells' regular Friday rows are recent enough
    // — saved data still beats a provider call, per the provider rule.
    const history = makeHistory(CELLS.map((c) => makeCondition(c, { lastUpdated: 1_800_000_000 })));
    const seed = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    const p2p = jest.fn(async () => []);

    const result = await resolveTrafficConditions({
      cells: CELLS,
      bucket: HOLIDAY_BUCKET,
      points: HOLIDAY_POINTS,
      history,
      seedFromTomTom: seed,
      p2pQuery: p2p,
    });

    expect(result.source).toBe('local-history');
    expect(result.unresolvedCells).toHaveLength(0);
    expect(p2p).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
  });

  it('records holiday-flagged peer answers into the holiday table', async () => {
    const history = makeHistory();
    await resolveTrafficConditions({
      cells: CELLS,
      bucket: HOLIDAY_BUCKET,
      points: HOLIDAY_POINTS,
      history,
      seedFromTomTom: async () => [],
      p2pQuery: async (cells) =>
        cells.map((c) => conditionToWire(makeCondition(c), true)).map((e) => ({ ...e, ho: 1 })),
    });

    // Peer data labelled holiday must land in the holiday table…
    const holidayRows = await history.getFresh(CELLS, HOLIDAY_BUCKET);
    expect(holidayRows).toHaveLength(3);
    // …and never in the regular weekly profile for that same Friday bucket.
    expect(await history.getFresh(CELLS, BUCKET)).toHaveLength(0);
  });

  it('records unlabelled peer answers (old peers) into the regular table', async () => {
    const history = makeHistory();
    await resolveTrafficConditions({
      cells: CELLS,
      bucket: HOLIDAY_BUCKET,
      points: HOLIDAY_POINTS,
      history,
      seedFromTomTom: async () => [],
      p2pQuery: async (cells) => cells.map((c) => conditionToWire(makeCondition(c), true)),
    });

    expect(await history.getFresh(CELLS, HOLIDAY_BUCKET)).toHaveLength(0);
    expect(await history.getFresh(CELLS, BUCKET)).toHaveLength(3);
  });
});
