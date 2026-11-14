/**
 * Pack-backed transit lines.
 *
 * The behaviour that matters here is the three-way answer: `null` means "no
 * pack covers this", which lets the caller fall through to a live source; `[]`
 * means "the pack indexed this area and has no routes in it", which must *not*
 * trigger a 495 MiB national GTFS download to rediscover; and a populated array
 * means the viewport is answered with zero network calls.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import { fetchLocalTransitLines } from '../../src/services/transit/localTransitLines';
import * as localTransitIndex from '../../src/services/transit/localTransitIndex';

const BOUNDS = { south: 52.4, west: 13.2, north: 52.6, east: 13.6 };

const ROUTE: localTransitIndex.LocalTransitRoute = {
  osmId: 4242,
  mode: 'SUBWAY',
  ref: 'U2',
  name: 'U2',
  colour: '#e4002b',
  // Stored [lat, lng], rendered [lng, lat].
  geometry: [
    [52.5, 13.3],
    [52.51, 13.35],
    [52.52, 13.4],
  ],
  stopIds: [1, 2, 99],
};

describe('fetchLocalTransitLines', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when no pack covers the box', async () => {
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockResolvedValue(false);
    const routes = jest.spyOn(localTransitIndex, 'queryTransitRoutesInBounds');

    expect(await fetchLocalTransitLines(BOUNDS)).toBeNull();
    expect(routes).not.toHaveBeenCalled();
  });

  it('returns an empty array when the pack covers the box but has no routes', async () => {
    // Distinct from null on purpose: an empty answer is final, and returning
    // null here is what would send the caller to a national GTFS download.
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockResolvedValue(true);
    jest.spyOn(localTransitIndex, 'queryTransitRoutesInBounds').mockResolvedValue([]);

    expect(await fetchLocalTransitLines(BOUNDS)).toEqual([]);
  });

  it('materialises route geometry, mode and colour from the pack', async () => {
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockResolvedValue(true);
    jest.spyOn(localTransitIndex, 'queryTransitRoutesInBounds').mockResolvedValue([ROUTE]);
    jest.spyOn(localTransitIndex, 'queryTransitStopsByIds').mockResolvedValue(
      new Map([
        [1, { osmId: 1, name: 'Alexanderplatz', lat: 52.5, lng: 13.3 }],
        [2, { osmId: 2, name: 'Klosterstraße', lat: 52.51, lng: 13.35 }],
      ]),
    );

    const lines = await fetchLocalTransitLines(BOUNDS);

    expect(lines).toHaveLength(1);
    const line = lines![0]!;
    expect(line.id).toBe('osm:route:4242');
    expect(line.ref).toBe('U2');
    expect(line.color).toBe('#e4002b');
    expect(line.mode).toBe('SUBWAY');
    // Single segment, [lng, lat] order, as the map layer expects.
    expect(line.geometry).toEqual([
      [
        [13.3, 52.5],
        [13.35, 52.51],
        [13.4, 52.52],
      ],
    ]);
  });

  it('drops stops the pack has no row for, keeping the rest', async () => {
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockResolvedValue(true);
    jest.spyOn(localTransitIndex, 'queryTransitRoutesInBounds').mockResolvedValue([ROUTE]);
    jest
      .spyOn(localTransitIndex, 'queryTransitStopsByIds')
      .mockResolvedValue(
        new Map([[1, { osmId: 1, name: 'Alexanderplatz', lat: 52.5, lng: 13.3 }]]),
      );

    const lines = await fetchLocalTransitLines(BOUNDS);
    // 99 has no row; the line still renders.
    expect(lines![0]!.stops.map((s) => s.name)).toEqual(['Alexanderplatz']);
    expect(lines![0]!.stops[0]!.stopId).toBe('osm:node:1');
  });

  it('renders a route with degenerate geometry without a polyline', async () => {
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockResolvedValue(true);
    jest
      .spyOn(localTransitIndex, 'queryTransitRoutesInBounds')
      .mockResolvedValue([{ ...ROUTE, geometry: [[52.5, 13.3]] }]);
    jest.spyOn(localTransitIndex, 'queryTransitStopsByIds').mockResolvedValue(new Map());

    const lines = await fetchLocalTransitLines(BOUNDS);
    expect(lines![0]!.geometry).toEqual([]);
    expect(lines![0]!.ref).toBe('U2');
  });

  it('keeps stop lookup failure from losing the lines', async () => {
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockResolvedValue(true);
    jest.spyOn(localTransitIndex, 'queryTransitRoutesInBounds').mockResolvedValue([ROUTE]);
    jest.spyOn(localTransitIndex, 'queryTransitStopsByIds').mockRejectedValue(new Error('db gone'));

    const lines = await fetchLocalTransitLines(BOUNDS);
    expect(lines).toHaveLength(1);
    expect(lines![0]!.stops).toEqual([]);
  });

  it('returns null when the index itself fails, so live sources still run', async () => {
    jest.spyOn(localTransitIndex, 'hasLocalTransitCoverage').mockRejectedValue(new Error('no db'));

    expect(await fetchLocalTransitLines(BOUNDS)).toBeNull();
  });
});
