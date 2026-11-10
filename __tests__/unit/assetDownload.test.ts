/**
 * Tests for assetDownload.ts — resumable, mirror-aware, delta-aware region
 * asset downloads (gaps 1 and 3 of the scale review).
 *
 * The transfer is exercised through an injected fake filesystem, so no native
 * module is involved.
 */

import type { RegionAsset } from '../../src/models/region';
import {
  backoffDelayMs,
  buildSourceList,
  downloadResumable,
  isRetryableFailure,
  localAssetState,
  planAssetDownloads,
  resumeSidecarPath,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  type DownloadFs,
} from '../../src/services/regions/assetDownload';

// ── Pure policy ──────────────────────────────────────────────────────

describe('buildSourceList', () => {
  it('keeps the primary first and dedupes mirrors', () => {
    expect(
      buildSourceList('https://a/x.gz', ['https://b/x.gz', 'https://a/x.gz', null, undefined]),
    ).toEqual(['https://a/x.gz', 'https://b/x.gz']);
  });

  it('drops blank and whitespace-only entries', () => {
    expect(buildSourceList('', ['   ', 'https://b/x.gz'])).toEqual(['https://b/x.gz']);
  });

  it('returns an empty list when nothing is usable', () => {
    expect(buildSourceList(null, [])).toEqual([]);
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt', () => {
    expect(backoffDelayMs(1)).toBe(RETRY_BASE_MS);
    expect(backoffDelayMs(2)).toBe(RETRY_BASE_MS * 2);
    expect(backoffDelayMs(3)).toBe(RETRY_BASE_MS * 4);
  });

  it('caps at the maximum', () => {
    expect(backoffDelayMs(20)).toBe(RETRY_MAX_MS);
  });
});

describe('isRetryableFailure', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('retries HTTP %i', (status) => {
    expect(isRetryableFailure(status, 'HTTP error')).toBe(true);
  });

  it.each([400, 401, 403, 404, 410])('does not retry HTTP %i', (status) => {
    expect(isRetryableFailure(status, 'HTTP error')).toBe(false);
  });

  it('retries network-flavoured failures without a status', () => {
    expect(isRetryableFailure(undefined, 'Network request failed')).toBe(true);
    expect(isRetryableFailure(undefined, 'socket hang up')).toBe(true);
    expect(isRetryableFailure(undefined, 'timed out')).toBe(true);
  });

  it('does not retry unknown failures without a status', () => {
    expect(isRetryableFailure(undefined, 'Checksum mismatch')).toBe(false);
  });
});

describe('planAssetDownloads (delta)', () => {
  const asset = (over: Partial<RegionAsset> = {}): RegionAsset => ({
    name: 'search.sqlite',
    url: 'https://example.test/search.sqlite.gz',
    md5: 'abc123',
    sizeBytes: 100,
    ...over,
  });

  it('skips an asset whose local checksum matches', () => {
    const plan = planAssetDownloads([asset()], new Map([['search.sqlite', { md5: 'abc123' }]]));
    expect(plan.skipped).toEqual(['search.sqlite']);
    expect(plan.toFetch).toHaveLength(0);
  });

  it('skips when the checksum matches case-insensitively', () => {
    const plan = planAssetDownloads([asset()], new Map([['search.sqlite', { md5: 'ABC123' }]]));
    expect(plan.skipped).toEqual(['search.sqlite']);
  });

  it('fetches when the checksum differs', () => {
    const plan = planAssetDownloads([asset()], new Map([['search.sqlite', { md5: 'def456' }]]));
    expect(plan.toFetch).toHaveLength(1);
  });

  it('falls back to size matching when no checksum is published', () => {
    const noMd5 = asset({ md5: null, sizeBytes: 100 });
    expect(
      planAssetDownloads([noMd5], new Map([['search.sqlite', { sizeBytes: 100 }]])).skipped,
    ).toEqual(['search.sqlite']);
    expect(
      planAssetDownloads([noMd5], new Map([['search.sqlite', { sizeBytes: 99 }]])).toFetch,
    ).toHaveLength(1);
  });

  it('fetches when the local file is missing', () => {
    expect(planAssetDownloads([asset()], new Map()).toFetch).toHaveLength(1);
  });

  it('fetches when neither checksum nor size is published', () => {
    const bare = asset({ md5: null, sizeBytes: null });
    const plan = planAssetDownloads([bare], new Map([['search.sqlite', { sizeBytes: 100 }]]));
    expect(plan.toFetch).toHaveLength(1);
  });
});

// ── Transfer ─────────────────────────────────────────────────────────

interface FakeCall {
  uri: string;
  fileUri: string;
  resumeData?: string;
}

/** Fake filesystem whose per-attempt behaviour is scripted by the test. */
function makeFs(
  script: Array<{ status?: number; error?: Error; savable?: string; bytes?: number }> = [],
) {
  const calls: FakeCall[] = [];
  const writes = new Map<string, string>();
  /** Every sidecar write, in order (the sidecar is cleared on success). */
  const writeLog: Array<[string, string]> = [];
  const deleted: string[] = [];
  /** Files a transfer attempt has started writing (partials left on disk). */
  const touched = new Set<string>();
  let attempt = 0;

  const fs: DownloadFs = {
    createResumable: (uri, fileUri, _options, onProgress, resumeData) => {
      const step = script[Math.min(attempt, script.length - 1)] ?? {};
      attempt++;
      calls.push({ uri, fileUri, resumeData });
      touched.add(fileUri);
      return {
        async downloadAsync() {
          const bytes = step.bytes ?? 1000;
          onProgress({ totalBytesWritten: bytes, totalBytesExpectedToWrite: bytes });
          if (step.error) throw step.error;
          return { status: step.status ?? 200, uri: fileUri };
        },
        savable: () => step.savable ?? '{"resume":true}',
      };
    },
    getInfoAsync: async (uri) => ({ exists: writes.has(uri) || touched.has(uri) }),
    deleteAsync: async (uri) => {
      deleted.push(uri);
      writes.delete(uri);
    },
    readAsStringAsync: async (uri) => writes.get(uri) ?? '',
    writeAsStringAsync: async (uri, content) => {
      writes.set(uri, content);
      writeLog.push([uri, content]);
    },
    makeDirectoryAsync: async () => {},
  };

  return { fs, calls, writes, writeLog, deleted };
}

const noSleep = async () => {};

describe('downloadResumable', () => {
  it('downloads from the primary source and clears the resume sidecar', async () => {
    const { fs, calls, deleted } = makeFs([{ bytes: 2048 }]);
    const result = await downloadResumable({
      destPath: '/r/search.sqlite.gz',
      sources: ['https://a/search.gz'],
      fs,
      sleep: noSleep,
    });
    expect(result.source).toBe('https://a/search.gz');
    expect(result.skipped).toBe(false);
    expect(calls).toHaveLength(1);
    expect(deleted).toContain(resumeSidecarPath('/r/search.sqlite.gz'));
  });

  it('retries a transient failure and resumes with the saved data', async () => {
    const { fs, calls, writeLog, deleted } = makeFs([
      { error: Object.assign(new Error('HTTP 503'), { status: 503 }), savable: 'RESUME-1' },
      { bytes: 4096 },
    ]);
    const result = await downloadResumable({
      destPath: '/r/search.sqlite.gz',
      sources: ['https://a/search.gz'],
      fs,
      sleep: noSleep,
    });

    expect(result.bytes).toBe(4096);
    expect(calls).toHaveLength(2);
    // The resume blob from attempt 1 was handed to attempt 2.
    expect(calls[1]!.resumeData).toBe('RESUME-1');
    // The sidecar was written from the failed attempt's savable() data...
    expect(writeLog).toContainEqual([resumeSidecarPath('/r/search.sqlite.gz'), 'RESUME-1']);
    // ...and cleared once the transfer completed.
    expect(deleted).toContain(resumeSidecarPath('/r/search.sqlite.gz'));
  });

  it('moves to the next mirror on a permanent failure', async () => {
    const { fs, calls } = makeFs([
      { error: Object.assign(new Error('HTTP 404'), { status: 404 }) },
      { bytes: 512 },
    ]);
    const result = await downloadResumable({
      destPath: '/r/search.sqlite.gz',
      sources: ['https://primary/search.gz', 'https://mirror/search.gz'],
      fs,
      sleep: noSleep,
    });

    expect(result.source).toBe('https://mirror/search.gz');
    expect(calls.map((c) => c.uri)).toEqual([
      'https://primary/search.gz',
      'https://mirror/search.gz',
    ]);
  });

  it('stops retrying a permanent failure on the same source', async () => {
    const { fs, calls } = makeFs([
      { error: Object.assign(new Error('HTTP 403'), { status: 403 }) },
    ]);
    await expect(
      downloadResumable({
        destPath: '/r/a.gz',
        sources: ['https://only/a.gz'],
        fs,
        sleep: noSleep,
        maxAttemptsPerSource: 3,
      }),
    ).rejects.toThrow(/403/);
    expect(calls).toHaveLength(1);
  });

  it('throws once every source and attempt is exhausted', async () => {
    const { fs, calls } = makeFs([
      { error: Object.assign(new Error('HTTP 503'), { status: 503 }) },
    ]);
    await expect(
      downloadResumable({
        destPath: '/r/a.gz',
        sources: ['https://a/a.gz', 'https://b/a.gz'],
        fs,
        sleep: noSleep,
        maxAttemptsPerSource: 2,
      }),
    ).rejects.toThrow(/503/);
    expect(calls).toHaveLength(4); // 2 sources × 2 attempts
  });

  it('rejects when no sources are given', async () => {
    const { fs } = makeFs();
    await expect(
      downloadResumable({ destPath: '/r/a.gz', sources: [], fs, sleep: noSleep }),
    ).rejects.toThrow(/no sources/);
  });

  it('honours an already-aborted signal', async () => {
    const { fs, calls } = makeFs();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadResumable({
        destPath: '/r/a.gz',
        sources: ['https://a/a.gz'],
        fs,
        sleep: noSleep,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);
    expect(calls).toHaveLength(0);
  });

  it('reports progress with byte counts and the active source', async () => {
    const { fs } = makeFs([{ bytes: 750 }]);
    const progress: number[] = [];
    await downloadResumable({
      destPath: '/r/a.gz',
      sources: ['https://a/a.gz'],
      fs,
      sleep: noSleep,
      onProgress: (p) => progress.push(p.bytesWritten),
    });
    expect(progress).toEqual([750]);
  });
});

describe('localAssetState', () => {
  it('collects md5 + size for existing assets and omits missing ones', async () => {
    const fs = {
      ...makeFs().fs,
      getInfoAsync: async (uri: string) =>
        uri.includes('search') ? { exists: true, md5: 'abc', size: 10 } : { exists: false },
    } as DownloadFs;

    const state = await localAssetState(
      '/r/',
      [
        { name: 'search.sqlite', url: 'https://x' },
        { name: 'transit.sqlite', url: 'https://y' },
      ],
      fs,
    );

    expect(state.get('search.sqlite')).toEqual({ md5: 'abc', sizeBytes: 10 });
    expect(state.has('transit.sqlite')).toBe(false);
  });
});
