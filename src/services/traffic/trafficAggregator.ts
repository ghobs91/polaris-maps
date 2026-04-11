import type { TrafficProbe, AggregatedTrafficState, CongestionLevel } from '../../models/traffic';

const WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window

interface ProbeEntry {
  speedMph: number;
  timestamp: number;
}

const segmentProbes = new Map<string, ProbeEntry[]>();
const aggregated = new Map<string, AggregatedTrafficState>();

export function ingestProbe(probe: TrafficProbe): AggregatedTrafficState | null {
  // Validate
  if (probe.speedMph < 0 || probe.speedMph > 190) return null;
  if (probe.bearing < 0 || probe.bearing >= 360) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(probe.timestamp - now) > 300) return null; // >5 min off
  if (!probe.segmentId) return null;

  // Store probe
  let entries = segmentProbes.get(probe.segmentId);
  if (!entries) {
    entries = [];
    segmentProbes.set(probe.segmentId, entries);
  }
  entries.push({ speedMph: probe.speedMph, timestamp: probe.timestamp });

  // Evict old probes
  const cutoff = now - WINDOW_MS / 1000;
  const fresh = entries.filter((e) => e.timestamp > cutoff);
  segmentProbes.set(probe.segmentId, fresh);

  if (fresh.length === 0) {
    aggregated.delete(probe.segmentId);
    return null;
  }

  // Compute rolling average
  const totalSpeed = fresh.reduce((sum, e) => sum + e.speedMph, 0);
  const avgSpeed = totalSpeed / fresh.length;
  const congestion = classifyCongestion(avgSpeed);

  const state: AggregatedTrafficState = {
    segmentId: probe.segmentId,
    avgSpeedMph: Math.round(avgSpeed * 10) / 10,
    sampleCount: fresh.length,
    congestionLevel: congestion,
    lastUpdated: now,
  };

  aggregated.set(probe.segmentId, state);
  return state;
}

function classifyCongestion(avgSpeedMph: number): CongestionLevel {
  if (avgSpeedMph < 3) return 'stopped';
  if (avgSpeedMph < 15) return 'congested';
  if (avgSpeedMph < 30) return 'slow';
  return 'free_flow';
}

export function getSegmentTraffic(segmentId: string): AggregatedTrafficState | undefined {
  return aggregated.get(segmentId);
}

export function getAllTrafficStates(): AggregatedTrafficState[] {
  return Array.from(aggregated.values());
}

export function getTrafficSpeedMap(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [segmentId, state] of aggregated) {
    map[segmentId] = state.avgSpeedMph;
  }
  return map;
}

export function clearTrafficData(): void {
  segmentProbes.clear();
  aggregated.clear();
}
