/**
 * Tests for seedDiagnostics.ts — seeding health instrumentation (gap 6).
 *
 * iOS suspends backgrounded apps, so seed availability has to be measured.
 * These tests cover the pure summary math and the rolling window.
 */

const mockGetHyperdriveStatus = jest.fn(async () => ({
  drives: [] as Array<{ regionId: string; key: string; discoveryKey: string; peers: number }>,
  swarmConnections: 0,
}));

jest.mock('../../src/services/sync/hyperdriveBridge', () => ({
  getHyperdriveStatus: (...args: unknown[]) => mockGetHyperdriveStatus(...(args as [])),
}));

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import {
  MAX_SAMPLES,
  __resetSeedInstrumentationForTests,
  getSeedSamples,
  getSeedSummary,
  recordSeedSample,
  sampleFromStatus,
  sampleSeeding,
  summarizeSamples,
  type SeedSample,
} from '../../src/services/sync/seedDiagnostics';

const sample = (drives: number, connections: number, reachable: number): SeedSample => ({
  at: 1_700_000_000_000,
  drives,
  connections,
  reachableDrives: reachable,
});

beforeEach(() => {
  __resetSeedInstrumentationForTests();
  mockGetHyperdriveStatus.mockClear();
});

describe('summarizeSamples', () => {
  it('returns zeros for an empty window', () => {
    expect(summarizeSamples([])).toEqual({
      samples: 0,
      avgDrives: 0,
      avgConnections: 0,
      availability: 0,
      idleSamples: 0,
    });
  });

  it('averages drives and connections', () => {
    const summary = summarizeSamples([sample(2, 10, 1), sample(0, 0, 0)]);
    expect(summary.samples).toBe(2);
    expect(summary.avgDrives).toBe(1);
    expect(summary.avgConnections).toBe(5);
    expect(summary.idleSamples).toBe(1);
  });

  it('computes availability as reachable drive-samples over all drive-samples', () => {
    // 1 reachable of 2 drives, then 2 of 2 → 3/4
    const summary = summarizeSamples([sample(2, 4, 1), sample(2, 6, 2)]);
    expect(summary.availability).toBe(0.75);
  });

  it('reports zero availability when nothing is seeded', () => {
    expect(summarizeSamples([sample(0, 0, 0)]).availability).toBe(0);
  });
});

describe('sampleFromStatus', () => {
  it('counts drives with at least one peer as reachable', () => {
    const s = sampleFromStatus({
      drives: [
        { regionId: 'a', peers: 3 },
        { regionId: 'b', peers: 0 },
      ],
      swarmConnections: 7,
    });
    expect(s.drives).toBe(2);
    expect(s.reachableDrives).toBe(1);
    expect(s.connections).toBe(7);
    expect(s.at).toBeGreaterThan(0);
  });
});

describe('rolling window', () => {
  it('caps the window at MAX_SAMPLES, dropping the oldest', () => {
    for (let i = 0; i < MAX_SAMPLES + 5; i++) recordSeedSample(sample(1, i, 1));
    const kept = getSeedSamples();
    expect(kept).toHaveLength(MAX_SAMPLES);
    // Oldest dropped: the first kept sample has connections === 5.
    expect(kept[0]!.connections).toBe(5);
  });

  it('summarizes the recorded window', () => {
    recordSeedSample(sample(1, 2, 1));
    recordSeedSample(sample(1, 4, 1));
    expect(getSeedSummary().availability).toBe(1);
  });
});

describe('sampleSeeding', () => {
  it('records a sample from the live Hyperdrive status', async () => {
    mockGetHyperdriveStatus.mockResolvedValueOnce({
      drives: [{ regionId: 'us-ny', key: 'k', discoveryKey: 'd', peers: 2 }],
      swarmConnections: 4,
    });
    const s = await sampleSeeding();
    expect(s?.drives).toBe(1);
    expect(getSeedSamples()).toHaveLength(1);
  });

  it('swallows failures and records nothing', async () => {
    mockGetHyperdriveStatus.mockRejectedValueOnce(new Error('worklet down'));
    await expect(sampleSeeding()).resolves.toBeNull();
    expect(getSeedSamples()).toHaveLength(0);
  });
});
