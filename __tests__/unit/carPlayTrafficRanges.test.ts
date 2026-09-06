import {
  buildCarPlayTrafficRanges,
  trafficRangesSignature,
} from '../../src/services/carplay/carPlayTrafficRanges';
import { encodePolyline } from '../../src/utils/polyline';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

function segment(ratio: number): NormalizedTrafficSegment {
  return {
    id: `seg-${ratio}`,
    coordinates: [
      [-73.98, 40.75],
      [-73.97, 40.76],
    ],
    currentSpeedMph: 30 * ratio,
    freeFlowSpeedMph: 30,
    congestionRatio: ratio,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: Date.now(),
  };
}

const geometry = encodePolyline([
  [-73.98, 40.75],
  [-73.975, 40.755],
  [-73.97, 40.76],
]);

describe('buildCarPlayTrafficRanges', () => {
  it('returns null with no segments or a degenerate route', () => {
    expect(buildCarPlayTrafficRanges(geometry, [])).toBeNull();
    expect(buildCarPlayTrafficRanges('', [segment(0.1)])).toBeNull();
  });

  it('returns null when the whole route is free-flow blue', () => {
    // 0.9 → congestionColor blue (the default) → single default run → null,
    // so free-flow traffic never costs a bridge call.
    expect(buildCarPlayTrafficRanges(geometry, [segment(0.9)])).toBeNull();
  });

  it('maps a congested run to shape indices', () => {
    expect(buildCarPlayTrafficRanges(geometry, [segment(0.1)])).toEqual([
      { color: '#D50000', from: 0, to: 2 },
    ]);
  });

  it('builds stable signatures', () => {
    expect(trafficRangesSignature(null)).toBe('');
    expect(trafficRangesSignature([{ color: '#D50000', from: 0, to: 2 }])).toBe('#D50000:0-2');
  });
});
