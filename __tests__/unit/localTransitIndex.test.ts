/**
 * On-device transit index helpers.
 *
 * The stop card's "which lines stop here?" used to be an Overpass round trip.
 * The index answers it from `transit.sqlite`; these tests cover the geometry
 * helpers and the schema that the pack importer writes into.
 */

import { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import {
  LOCAL_TRANSIT_SCHEMA_SQL,
  bboxForRadius,
  haversineMeters,
  transitModeFor,
} from '../../src/services/transit/localTransitIndex';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(40.748, -73.985, 40.748, -73.985)).toBe(0);
  });

  it('matches a known short distance', () => {
    // ~111 m per 0.001° of latitude at the equator.
    const d = haversineMeters(0, 0, 0.001, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('is symmetric', () => {
    const a = haversineMeters(40.748, -73.985, 40.758, -73.978);
    const b = haversineMeters(40.758, -73.978, 40.748, -73.985);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('bboxForRadius', () => {
  it('contains points inside the radius and excludes points outside', () => {
    const box = bboxForRadius(40.748, -73.985, 100);
    expect(box.south).toBeLessThan(40.748);
    expect(box.north).toBeGreaterThan(40.748);
    expect(box.west).toBeLessThan(-73.985);
    expect(box.east).toBeGreaterThan(-73.985);

    // A point ~50 m north is inside; ~500 m north is outside.
    const inside = 40.748 + 0.0004;
    const outside = 40.748 + 0.005;
    expect(inside).toBeLessThan(box.north);
    expect(outside).toBeGreaterThan(box.north);
  });

  it('does not blow up near the poles', () => {
    const box = bboxForRadius(89.999, 0, 1000);
    expect(Number.isFinite(box.west)).toBe(true);
    expect(Number.isFinite(box.east)).toBe(true);
  });
});

describe('transitModeFor', () => {
  it('maps OSM route values to app modes', () => {
    expect(transitModeFor('subway')).toBe('SUBWAY');
    expect(transitModeFor('tram')).toBe('TRAM');
    expect(transitModeFor('light_rail')).toBe('TRAM');
    expect(transitModeFor('monorail')).toBe('RAIL');
    expect(transitModeFor(undefined)).toBe('RAIL');
  });
});

describe('transit schema', () => {
  it('creates the tables and answers a stop-to-route join', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(LOCAL_TRANSIT_SCHEMA_SQL);

    db.exec(`
      INSERT INTO osm_transit_stops (osm_id, name, lat, lng, tags_json, region_id, updated_at)
      VALUES (100, 'Bleecker St', 40.7255, -73.9947, '{"railway":"station"}', 'nyc', 1),
             (200, 'Astor Pl', 40.7300, -73.9910, '{"railway":"station"}', 'nyc', 1);

      INSERT INTO osm_transit_routes
        (osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
         south, west, north, east, region_id, updated_at)
      VALUES (9, 'SUBWAY', '6', 'Lexington Av Local', '00933C',
              '[[40.72,-73.99],[40.73,-73.99]]', '[100,200]', 40.72, -73.99, 40.73, -73.99, 'nyc', 1);

      INSERT INTO osm_transit_route_stops (stop_osm_id, route_osm_id) VALUES (100, 9), (200, 9);
    `);

    const rows = db
      .prepare(
        `SELECT r.ref AS ref, r.mode AS mode
           FROM osm_transit_route_stops rs
           JOIN osm_transit_routes r ON r.osm_id = rs.route_osm_id
          WHERE rs.stop_osm_id = ?`,
      )
      .all(100) as Array<{ ref: string; mode: string }>;

    expect(rows).toEqual([{ ref: '6', mode: 'SUBWAY' }]);
    db.close();
  });
});
