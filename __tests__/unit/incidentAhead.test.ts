import { findIncidentsAhead } from '../../src/services/traffic/incidentAhead';
import { encode as geohashEncode } from '../../src/utils/geohash';
import type { IncidentType, TrafficIncident } from '../../src/models/traffic';

// A straight ~3.3 km route heading east at the equator. 0.01° lng ≈ 1113 m.
const ROUTE: [number, number][] = [
  [0, 0],
  [0.01, 0],
  [0.02, 0],
  [0.03, 0],
];

function incident(lng: number, overrides: Partial<TrafficIncident> = {}): TrafficIncident {
  const type: IncidentType = 'hazard';
  return {
    id: `inc-${lng}`,
    reporterPubkey: 'pubkey',
    lat: 0,
    lng,
    geohash6: geohashEncode(0, lng, 6),
    type,
    description: '',
    reportedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 3_600_000,
    signature: new Uint8Array(0),
    ...overrides,
  };
}

describe('findIncidentsAhead', () => {
  it('returns incidents ahead within the look-ahead window', () => {
    const result = findIncidentsAhead(ROUTE, [0, 0], [incident(0.02)]);
    expect(result).toHaveLength(1);
  });

  it('excludes incidents behind the vehicle', () => {
    const result = findIncidentsAhead(ROUTE, [0.02, 0], [incident(0.01)]);
    expect(result).toHaveLength(0);
  });

  it('excludes incidents beyond the look-ahead window', () => {
    const result = findIncidentsAhead(ROUTE, [0, 0], [incident(0.03)], { lookaheadMeters: 1_000 });
    expect(result).toHaveLength(0);
  });

  it('excludes expired incidents', () => {
    const result = findIncidentsAhead(
      ROUTE,
      [0, 0],
      [incident(0.02, { expiresAt: Date.now() - 1 })],
    );
    expect(result).toHaveLength(0);
  });

  it('orders incidents nearest first', () => {
    const result = findIncidentsAhead(ROUTE, [0, 0], [incident(0.02), incident(0.01)]);
    expect(result.map((i) => i.id)).toEqual(['inc-0.01', 'inc-0.02']);
  });

  it('returns nothing for a route with fewer than two vertices', () => {
    const result = findIncidentsAhead([[0, 0]], [0, 0], [incident(0.02)]);
    expect(result).toHaveLength(0);
  });
});
