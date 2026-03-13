import type { NormalizedTrafficSegment, AggregatedTrafficState } from '../../models/traffic';
import { ROAD_CLASS_SPEEDS } from '../../models/traffic';
import { decode as geohashDecode } from '../../utils/geohash';

const MERGE_PROXIMITY_METERS = 30;
const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

function haversineMeters(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG_TO_RAD;
  const dLng = (b[0] - a[0]) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(a[1] * DEG_TO_RAD) * Math.cos(b[1] * DEG_TO_RAD) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Get the first coordinate of a segment (used for proximity matching). */
function firstCoord(seg: NormalizedTrafficSegment): [number, number] {
  return seg.coordinates[0];
}

/**
 * Convert a P2P AggregatedTrafficState into a NormalizedTrafficSegment.
 * Confidence scales linearly from 0 (1 sample) to 0.7 (5+ samples).
 * Uses geohash6 centroid for coordinates.
 */
export function convertP2PToNormalized(state: AggregatedTrafficState): NormalizedTrafficSegment {
  const centroid = geohashDecode(state.segmentId);
  const freeFlowSpeedKmh = ROAD_CLASS_SPEEDS.secondary; // default 50 km/h
  const confidence = Math.min(1.0, state.sampleCount / 5) * 0.7;
  const ratio =
    freeFlowSpeedKmh > 0 ? Math.min(1, Math.max(0, state.avgSpeedKmh / freeFlowSpeedKmh)) : 0;

  return {
    id: `p2p:${state.segmentId}`,
    coordinates: [[centroid.lng, centroid.lat]],
    currentSpeedKmh: state.avgSpeedKmh,
    freeFlowSpeedKmh,
    congestionRatio: ratio,
    confidence,
    source: 'p2p',
    timestamp: state.lastUpdated,
  };
}

/**
 * Merge traffic segments from multiple sources using confidence-weighted averaging
 * for overlapping segments (within 30m proximity).
 *
 * @param segments All segments from all sources
 * @param previousMergeTimestamp If provided, discard segments older than this
 */
export function mergeTrafficSources(
  segments: NormalizedTrafficSegment[],
  previousMergeTimestamp?: number,
): NormalizedTrafficSegment[] {
  // Filter stale segments
  const filtered =
    previousMergeTimestamp != null
      ? segments.filter((s) => s.timestamp >= previousMergeTimestamp)
      : segments;

  if (filtered.length === 0) return [];

  // Group overlapping segments by proximity
  const merged: NormalizedTrafficSegment[] = [];
  const used = new Set<number>();

  for (let i = 0; i < filtered.length; i++) {
    if (used.has(i)) continue;

    const group: NormalizedTrafficSegment[] = [filtered[i]];
    used.add(i);

    // Find all segments within proximity threshold of this one
    for (let j = i + 1; j < filtered.length; j++) {
      if (used.has(j)) continue;
      if (filtered[j].source === filtered[i].source) continue; // Don't merge same-source

      const coordA = firstCoord(filtered[i]);
      const coordB = firstCoord(filtered[j]);
      if (coordA && coordB && haversineMeters(coordA, coordB) <= MERGE_PROXIMITY_METERS) {
        group.push(filtered[j]);
        used.add(j);
      }
    }

    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      // Confidence-weighted averaging
      let weightedSpeed = 0;
      let totalConfidence = 0;
      let maxFreeFlow = 0;
      let latestTimestamp = 0;

      for (const seg of group) {
        weightedSpeed += seg.currentSpeedKmh * seg.confidence;
        totalConfidence += seg.confidence;
        maxFreeFlow = Math.max(maxFreeFlow, seg.freeFlowSpeedKmh);
        latestTimestamp = Math.max(latestTimestamp, seg.timestamp);
      }

      const avgSpeed = totalConfidence > 0 ? weightedSpeed / totalConfidence : 0;
      const ratio = maxFreeFlow > 0 ? Math.min(1, Math.max(0, avgSpeed / maxFreeFlow)) : 0;
      const sources = group.map((s) => s.source).join('+');

      merged.push({
        id: `merged:${group.map((s) => s.id).join('|')}`,
        coordinates: group[0].coordinates, // Use coordinates from highest-confidence source
        currentSpeedKmh: avgSpeed,
        freeFlowSpeedKmh: maxFreeFlow,
        congestionRatio: ratio,
        confidence: Math.min(1, totalConfidence),
        source: group.reduce((best, s) => (s.confidence > best.confidence ? s : best)).source,
        timestamp: latestTimestamp,
      });
    }
  }

  return merged;
}
