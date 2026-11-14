/**
 * GTFS runtime size cap.
 *
 * A consolidated country feed is far past what a phone can hold: Germany's is
 * 495 MiB, and the previous code called `res.arrayBuffer()` on it before a
 * single row was parsed. This pins the guard that rejects those feeds without
 * buffering them, and confirms a normal city feed still gets through.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import { GTFS_MAX_FEED_BYTES } from '../../src/constants/config';
import { fetchGtfsStaticLines } from '../../src/services/transit/gtfsStaticFetcher';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** A minimal zip-shaped body; the parser rejects it, which is fine — we only
 *  care whether it was read at all. */
function zipResponse(bytes: number, headers: Record<string, string> = {}) {
  const body = new Uint8Array(Math.min(bytes, 1024));
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () => body.buffer,
    body: null,
  };
}

/** A response whose body streams `chunks` of `chunkSize`, with no content-length. */
function streamingResponse(chunks: number, chunkSize: number) {
  let sent = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
    body: {
      getReader: () => ({
        read: async () => {
          if (sent >= chunks) return { done: true, value: undefined };
          sent += 1;
          return { done: false, value: new Uint8Array(chunkSize) };
        },
        cancel: async () => undefined,
      }),
    },
  };
}

const FEED = { feedUrl: 'https://example.invalid/gtfs.zip', label: 'Testland GTFS' };

describe('GTFS runtime size cap', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockFetch.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('rejects a national feed from its content-length, without reading the body', async () => {
    // Germany's real size.
    mockFetch.mockResolvedValue(
      zipResponse(GTFS_MAX_FEED_BYTES, { 'content-length': '519449786' }),
    );

    const lines = await fetchGtfsStaticLines(FEED);

    expect(lines).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('over the'));
  });

  it('accepts a feed at the cap', async () => {
    mockFetch.mockResolvedValue(
      zipResponse(GTFS_MAX_FEED_BYTES, { 'content-length': String(GTFS_MAX_FEED_BYTES) }),
    );

    // Reaches the zip parser rather than being rejected up front.
    await fetchGtfsStaticLines(FEED);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('over the'));
  });

  it('aborts a streamed body that exceeds the cap without a content-length', async () => {
    // 8 chunks x 8 MiB = 64 MiB, twice the cap.
    mockFetch.mockResolvedValue(streamingResponse(8, 8 * 1024 * 1024));

    const lines = await fetchGtfsStaticLines(FEED);

    expect(lines).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('exceeded the'));
  });

  it('lets a small streamed feed through', async () => {
    mockFetch.mockResolvedValue(streamingResponse(2, 1024));

    await fetchGtfsStaticLines(FEED);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('exceeded the'));
  });
});
