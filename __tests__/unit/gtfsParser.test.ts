import {
  parseCsv,
  parseCsvLine,
  parseGtfsColor,
  routeTypeToMode,
  ALL_ROUTE_TYPES,
  parseGtfsFeed,
  convertFeedToLines,
  DEFAULT_GTFS_MODE_MAP,
  extractZipTexts,
} from '../../src/services/transit/gtfsParser';
import type { GtfsFetcherConfig } from '../../src/services/transit/gtfsParser';
import { deflateRaw } from 'pako';

// ── parseCsv / parseCsvLine ──────────────────────────────────────────

describe('parseCsv', () => {
  it('parses a simple CSV with headers', () => {
    const text = 'a,b,c\n1,2,3\n4,5,6';
    const result = parseCsv(text);
    expect(result).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('handles quoted fields with commas', () => {
    const text = 'name,city\n"King County","Seattle, WA"\n"Pierce Transit","Lakewood, WA"';
    const result = parseCsv(text);
    expect(result).toEqual([
      { name: 'King County', city: 'Seattle, WA' },
      { name: 'Pierce Transit', city: 'Lakewood, WA' },
    ]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    const text = 'name,desc\n"Agency ""X""",test';
    const result = parseCsv(text);
    expect(result).toEqual([{ name: 'Agency "X"', desc: 'test' }]);
  });

  it('returns empty array for header-only CSV', () => {
    const text = 'a,b,c';
    expect(parseCsv(text)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvLine', () => {
  it('splits a simple line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted values', () => {
    expect(parseCsvLine('"value with spaces",b,c')).toEqual(['value with spaces', 'b', 'c']);
  });

  it('handles empty values', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('trims whitespace', () => {
    expect(parseCsvLine(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });
});

// ── parseGtfsColor ───────────────────────────────────────────────────

describe('parseGtfsColor', () => {
  it('returns cleaned hex color', () => {
    expect(parseGtfsColor('#FF5733')).toBe('FF5733');
  });

  it('returns undefined for missing value', () => {
    expect(parseGtfsColor(undefined)).toBeUndefined();
  });

  it('returns undefined for malformed value', () => {
    expect(parseGtfsColor('not-a-color')).toBeUndefined();
  });

  it('handles colors without hash prefix', () => {
    expect(parseGtfsColor('00FF00')).toBe('00FF00');
  });
});

// ── routeTypeToMode ──────────────────────────────────────────────────

describe('routeTypeToMode', () => {
  it('maps tram (0) to TRAM', () => {
    expect(routeTypeToMode(0)).toBe('TRAM');
  });

  it('maps subway (1) to SUBWAY', () => {
    expect(routeTypeToMode(1)).toBe('SUBWAY');
  });

  it('maps rail (2) to RAIL', () => {
    expect(routeTypeToMode(2)).toBe('RAIL');
  });

  it('maps standard GTFS route types', () => {
    expect(routeTypeToMode(0)).toBe('TRAM');
    expect(routeTypeToMode(1)).toBe('SUBWAY');
    expect(routeTypeToMode(2)).toBe('RAIL');
    expect(routeTypeToMode(3)).toBe('FERRY');
    expect(routeTypeToMode(4)).toBe('CABLE_CAR');
    expect(routeTypeToMode(5)).toBe('GONDOLA');
    expect(routeTypeToMode(6)).toBe('FUNICULAR');
    expect(routeTypeToMode(99)).toBe('BUS'); // unknown → falls back to BUS
  });

  it('uses custom mode map when provided', () => {
    const custom: Record<number, import('../../src/models/transit').TransitMode> = { 3: 'FERRY' };
    expect(routeTypeToMode(3, custom)).toBe('FERRY');
  });
});

// ── parseGtfsFeed ────────────────────────────────────────────────────

describe('parseGtfsFeed', () => {
  function makeFiles(overrides: Record<string, string> = {}) {
    const defaults: Record<string, string> = {
      'routes.txt':
        'route_id,route_short_name,route_long_name,route_type,route_color\n1,A,Alpha,1,FF0000\n2,B,Beta,3,00FF00',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,location_type\nS1,Main St,40.7,-74.0,1',
      'trips.txt': 'trip_id,route_id,service_id,shape_id\nT1,1,svc1,shape1\nT2,2,svc1,shape2',
      'stop_times.txt':
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:30,S1,1\nT2,09:00:00,09:00:30,S1,1',
      'shapes.txt':
        'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshape1,40.70,-74.00,1\nshape1,40.71,-74.01,2\nshape2,40.72,-74.02,1\nshape2,40.73,-74.03,2',
      'agency.txt': 'agency_name\nTest Agency',
    };
    return new Map(Object.entries({ ...defaults, ...overrides }));
  }

  it('parses a complete GTFS feed', () => {
    const files = makeFiles();
    const feed = parseGtfsFeed(files, 'test-id', 'Test Agency');
    expect(feed).not.toBeNull();
    expect(feed!.routes).toHaveLength(2);
    expect(feed!.stops).toHaveLength(1);
    expect(feed!.trips).toHaveLength(2);
    expect(feed!.stopTimes).toHaveLength(2);
    expect(feed!.shapes.size).toBe(2);
    expect(feed!.feedName).toBe('Test Agency');
  });

  it('returns null when routes.txt is empty', () => {
    const files = makeFiles({ 'routes.txt': 'route_id\n' });
    const feed = parseGtfsFeed(files, 'id', 'provider');
    expect(feed).toBeNull();
  });

  it('filters routes by routeTypeFilter', () => {
    const files = makeFiles();
    const feed = parseGtfsFeed(files, 'id', 'provider', { routeTypeFilter: [1] });
    expect(feed).not.toBeNull();
    expect(feed!.routes).toHaveLength(2); // all routes parsed, filtered in convertFeedToLines
  });

  it('builds correct shape maps with [lng, lat] ordering', () => {
    const files = makeFiles();
    const feed = parseGtfsFeed(files, 'id', 'provider');
    const shape = feed!.shapes.get('shape1')!;
    expect(shape).toHaveLength(2);
    expect(shape[0]).toEqual([-74.0, 40.7]);
    expect(shape[1]).toEqual([-74.01, 40.71]);
  });

  it('returns null when routes.txt is missing', () => {
    const files = new Map([['stops.txt', 'stop_id\n']]);
    const feed = parseGtfsFeed(files, 'id', 'provider');
    expect(feed).toBeNull();
  });
});

// ── convertFeedToLines ───────────────────────────────────────────────

describe('convertFeedToLines', () => {
  function makeFeedData(
    overrides: Partial<import('../../src/services/transit/gtfsParser').GtfsFeedData> = {},
  ) {
    const routes = overrides.routes ?? [
      {
        route_id: 'R1',
        route_short_name: 'A',
        route_long_name: 'Alpha Line',
        route_type: 1,
        route_color: 'FF0000',
      },
    ];
    const stops = overrides.stops ?? [
      { stop_id: 'S1', stop_name: 'Station 1', stop_lat: 40.7, stop_lon: -74.0 },
      { stop_id: 'S2', stop_name: 'Station 2', stop_lat: 40.71, stop_lon: -74.01 },
    ];
    const trips = overrides.trips ?? [
      { trip_id: 'T1', route_id: 'R1', service_id: 'svc', shape_id: 'shape1' },
    ];
    const shapes =
      overrides.shapes ??
      new Map([
        [
          'shape1',
          [
            [-74.0, 40.7],
            [-74.01, 40.71],
            [-74.02, 40.72],
          ] as [number, number][],
        ],
      ]);
    const stopTimes = overrides.stopTimes ?? [
      {
        trip_id: 'T1',
        arrival_time: '08:00',
        departure_time: '08:01',
        stop_id: 'S1',
        stop_sequence: 1,
      },
      {
        trip_id: 'T1',
        arrival_time: '08:10',
        departure_time: '08:11',
        stop_id: 'S2',
        stop_sequence: 2,
      },
    ];

    return {
      feedId: 'test-feed',
      provider: 'Test',
      feedName: 'Test Agency',
      routes,
      stops,
      trips,
      stopTimes,
      shapes,
      tripIndex: new Map(trips.map((t) => [t.trip_id, t])),
      stopIndex: new Map(stops.map((s) => [s.stop_id, s])),
      routeIndex: new Map(routes.map((r) => [r.route_id, r])),
      stopTrips: new Map([
        ['S1', ['T1']],
        ['S2', ['T1']],
      ]),
      ...overrides,
    };
  }

  const config: GtfsFetcherConfig = {
    label: 'Test',
    routeTypeFilter: [1],
  };

  it('converts a feed to TransitRouteLine', async () => {
    const feed = makeFeedData();
    const lines = await convertFeedToLines(feed, config);
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe('gtfs:test-feed:R1');
    expect(lines[0].ref).toBe('A');
    expect(lines[0].name).toBe('Alpha Line');
    expect(lines[0].color).toBe('FF0000');
    expect(lines[0].mode).toBe('SUBWAY');
    expect(lines[0].geometry).toHaveLength(1);
    expect(lines[0].geometry[0].length).toBeGreaterThanOrEqual(2);
    expect(lines[0].stops.length).toBeGreaterThanOrEqual(1);
  });

  it('filters routes by routeTypeFilter', async () => {
    const feed = makeFeedData({
      routes: [
        { route_id: 'R1', route_short_name: 'A', route_long_name: 'Alpha', route_type: 1 },
        { route_id: 'R2', route_short_name: 'B', route_long_name: 'Beta', route_type: 3 },
      ],
    });
    const lines = await convertFeedToLines(feed, config);
    expect(lines).toHaveLength(1);
    expect(lines[0].ref).toBe('A');
  });

  it('skips routes with less than 2 geometry points', async () => {
    const feed = makeFeedData({
      shapes: new Map([['shape1', [[-74.0, 40.7]] as [number, number][]]]),
    });
    const lines = await convertFeedToLines(feed, config);
    expect(lines).toHaveLength(0);
  });

  it('returns empty for empty routes', async () => {
    const feed = makeFeedData({ routes: [] });
    const lines = await convertFeedToLines(feed, config);
    expect(lines).toHaveLength(0);
  });
});

// ── ALL_ROUTE_TYPES ──────────────────────────────────────────────────

describe('ALL_ROUTE_TYPES', () => {
  it('includes all standard GTFS route types', () => {
    expect(ALL_ROUTE_TYPES).toContain(0);
    expect(ALL_ROUTE_TYPES).toContain(1);
    expect(ALL_ROUTE_TYPES).toContain(2);
    expect(ALL_ROUTE_TYPES).toContain(3);
    expect(ALL_ROUTE_TYPES).toContain(4);
    expect(ALL_ROUTE_TYPES).toContain(5);
    expect(ALL_ROUTE_TYPES).toContain(6);
  });
});

// ── extractZipTexts ──────────────────────────────────────────────────

describe('extractZipTexts', () => {
  /**
   * Build a minimal ZIP file in memory with a single DEFLATE-compressed entry.
   * ZIP local file header format:
   *   - 4 bytes: signature (0x04034b50)
   *   - 2 bytes: version needed
   *   - 2 bytes: general purpose bit flag
   *   - 2 bytes: compression method (0=STORE, 8=DEFLATE)
   *   - 2 bytes: last mod file time
   *   - 2 bytes: last mod file date
   *   - 4 bytes: CRC-32
   *   - 4 bytes: compressed size
   *   - 4 bytes: uncompressed size
   *   - 2 bytes: file name length
   *   - 2 bytes: extra field length
   *   - n bytes: file name
   *   - n bytes: extra field
   *   - n bytes: compressed data
   */
  function buildZipEntry(fileName: string, content: string, compress = true): Uint8Array {
    const encoder = new TextEncoder();
    const contentBytes = encoder.encode(content);
    const nameBytes = encoder.encode(fileName);

    let compressedData: Uint8Array;
    let crc: number;
    let compressionMethod: number;

    if (compress) {
      compressionMethod = 8; // DEFLATE
      compressedData = deflateRaw(contentBytes);
      // CRC-32 of uncompressed data
      crc = crc32(contentBytes);
    } else {
      compressionMethod = 0; // STORE
      compressedData = contentBytes;
      crc = crc32(contentBytes);
    }

    const header = new ArrayBuffer(30 + nameBytes.length);
    const view = new DataView(header);
    const bytes = new Uint8Array(header);

    view.setUint32(0, 0x04034b50, true); // signature
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // general purpose bit flag
    view.setUint16(8, compressionMethod, true); // compression method
    view.setUint16(10, 0, true); // last mod file time
    view.setUint16(12, 0, true); // last mod file date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, compressedData.length, true); // compressed size
    view.setUint32(22, contentBytes.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true); // file name length
    view.setUint16(28, 0, true); // extra field length
    bytes.set(nameBytes, 30);

    const result = new Uint8Array(header.byteLength + compressedData.length);
    result.set(bytes, 0);
    result.set(compressedData, header.byteLength);
    return result;
  }

  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    const table = getCrc32Table();
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function getCrc32Table(): number[] {
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table.push(c >>> 0);
    }
    return table;
  }

  it('extracts DEFLATE-compressed files from a ZIP', async () => {
    const routesContent = 'route_id,route_short_name,route_type\nR1,A,1\n';
    const entry = buildZipEntry('routes.txt', routesContent, true);
    const zipBuffer = entry.buffer;

    const result = await extractZipTexts(zipBuffer, ['routes.txt']);
    expect(result.get('routes.txt')).toBe(routesContent);
  });

  it('extracts STORE (uncompressed) files from a ZIP', async () => {
    const routesContent = 'route_id,route_short_name,route_type\nR1,A,1\n';
    const entry = buildZipEntry('routes.txt', routesContent, false);
    const zipBuffer = entry.buffer;

    const result = await extractZipTexts(zipBuffer, ['routes.txt']);
    expect(result.get('routes.txt')).toBe(routesContent);
  });

  it('extracts multiple files from a ZIP', async () => {
    const routesContent = 'route_id,route_short_name,route_type\nR1,A,1\n';
    const stopsContent = 'stop_id,stop_name,stop_lat,stop_lon\nS1,Main,40.7,-74.0\n';

    const routesEntry = buildZipEntry('routes.txt', routesContent, true);
    const stopsEntry = buildZipEntry('stops.txt', stopsContent, true);

    const combined = new Uint8Array(routesEntry.length + stopsEntry.length);
    combined.set(routesEntry, 0);
    combined.set(stopsEntry, routesEntry.length);

    const result = await extractZipTexts(combined.buffer, ['routes.txt', 'stops.txt']);
    expect(result.get('routes.txt')).toBe(routesContent);
    expect(result.get('stops.txt')).toBe(stopsContent);
  });

  it('handles files nested in subdirectories', async () => {
    const routesContent = 'route_id,route_short_name,route_type\nR1,A,1\n';
    const entry = buildZipEntry('google_transit/routes.txt', routesContent, true);
    const zipBuffer = entry.buffer;

    const result = await extractZipTexts(zipBuffer, ['routes.txt']);
    expect(result.get('routes.txt')).toBe(routesContent);
  });
});
