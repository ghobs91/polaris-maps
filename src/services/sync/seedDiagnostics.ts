import { getHyperdriveStatus } from '../sync/hyperdriveBridge';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

/**
 * Seeding health instrumentation.
 *
 * iOS suspends backgrounded apps, so a phone is a weaker seed than a desktop
 * BitTorrent client — the mesh's real availability has to be *measured*, not
 * assumed. This module samples the Hyperdrive swarm periodically and records
 * what seeding actually looked like:
 *
 *   - how many drives this device seeds
 *   - how many peers each drive has (0 = seeded but unreachable)
 *   - total swarm connections
 *   - the fraction of samples where a drive had at least one peer
 *     ("seed availability"), which is the number that matters for cold start
 *
 * Samples go to the diagnostics log (ring buffer, no PII) and to an in-memory
 * rolling summary that the diagnostics screen can render. Nothing is uploaded:
 * measuring seeding must not itself create traffic.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** How often the swarm is sampled while the app is foregrounded. */
export const SEED_SAMPLE_INTERVAL_MS = 60_000;

/** Rolling window of samples kept for the summary (1 hour at 1/min). */
export const MAX_SAMPLES = 60;

// ── Types ────────────────────────────────────────────────────────────

export interface SeedSample {
  /** Epoch ms of the sample. */
  at: number;
  /** Drives this device is seeding. */
  drives: number;
  /** Swarm connections across all drives. */
  connections: number;
  /** Drives with at least one connected peer. */
  reachableDrives: number;
}

export interface SeedSummary {
  samples: number;
  /** Mean drives seeded per sample. */
  avgDrives: number;
  /** Mean swarm connections per sample. */
  avgConnections: number;
  /**
   * Fraction of drive-samples that had ≥1 peer (0–1). This is the seeding
   * availability figure: how often a seeder is actually reachable.
   */
  availability: number;
  /** Samples with zero drives seeded (nothing to serve). */
  idleSamples: number;
}

// ── Pure summary (unit tested) ───────────────────────────────────────

/** Reduce a set of samples into the summary the diagnostics screen shows. */
export function summarizeSamples(samples: readonly SeedSample[]): SeedSummary {
  if (samples.length === 0) {
    return { samples: 0, avgDrives: 0, avgConnections: 0, availability: 0, idleSamples: 0 };
  }
  let drives = 0;
  let connections = 0;
  let reachable = 0;
  let idle = 0;
  for (const s of samples) {
    drives += s.drives;
    connections += s.connections;
    reachable += s.reachableDrives;
    if (s.drives === 0) idle++;
  }
  return {
    samples: samples.length,
    avgDrives: round2(drives / samples.length),
    avgConnections: round2(connections / samples.length),
    availability: drives === 0 ? 0 : round2(reachable / drives),
    idleSamples: idle,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Build a sample from a Hyperdrive status snapshot. */
export function sampleFromStatus(status: {
  drives: ReadonlyArray<{ regionId: string; peers: number }>;
  swarmConnections: number;
}): SeedSample {
  return {
    at: Date.now(),
    drives: status.drives.length,
    connections: status.swarmConnections,
    reachableDrives: status.drives.filter((d) => d.peers > 0).length,
  };
}

// ── Recorder ─────────────────────────────────────────────────────────

let samples: SeedSample[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Record one sample into the rolling window. */
export function recordSeedSample(sample: SeedSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
}

/** Sample the swarm once (best-effort; failures are silent). */
export async function sampleSeeding(): Promise<SeedSample | null> {
  try {
    const status = await getHyperdriveStatus();
    const sample = sampleFromStatus(status);
    recordSeedSample(sample);
    logDiagnostic('sync', 'info', 'seed sample', { ...sample });
    return sample;
  } catch {
    return null;
  }
}

/** Start periodic sampling (idempotent). */
export function startSeedInstrumentation(): void {
  if (intervalId) return;
  void sampleSeeding();
  intervalId = setInterval(() => {
    void sampleSeeding();
  }, SEED_SAMPLE_INTERVAL_MS);
}

/** Stop sampling and clear the window. */
export function stopSeedInstrumentation(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  samples = [];
}

/** Current rolling summary. */
export function getSeedSummary(): SeedSummary {
  return summarizeSamples(samples);
}

/** Raw samples (diagnostics export / tests). */
export function getSeedSamples(): readonly SeedSample[] {
  return samples;
}

/** Test-only: reset without touching timers. */
export function __resetSeedInstrumentationForTests(): void {
  samples = [];
  intervalId = null;
}
