/**
 * Auto region download policy.
 *
 * Downloading a few hundred megabytes without being asked is hostile, so the
 * decision is conservative: enabled, inside a known region, not already
 * downloaded/downloading, enough free disk for the pack plus its expanded tree,
 * unmetered unless opted in, and only after the viewport settles.
 */

import {
  AUTO_DOWNLOAD_DISK_HEADROOM,
  AUTO_DOWNLOAD_MAX_ATTEMPTS,
  decideAutoDownload,
  describeDecision,
  type AutoDownloadContext,
} from '../../src/services/regions/autoRegionDownload';

const BASE: AutoDownloadContext = {
  enabled: true,
  regionId: 'us-new-york',
  packSizeBytes: 40 * 1024 * 1024,
  // Comfortably more than the pack plus its expanded tree.
  freeBytes: 4 * 1024 * 1024 * 1024,
  downloaded: false,
  downloading: false,
  metered: false,
  allowMetered: false,
  attempts: 0,
  settled: true,
};

const ctx = (over: Partial<AutoDownloadContext> = {}): AutoDownloadContext => ({
  ...BASE,
  ...over,
});

describe('decideAutoDownload', () => {
  it('starts for a small pack in the viewport region on wifi', () => {
    const decision = decideAutoDownload(ctx());
    expect(decision).toEqual({ start: true, regionId: 'us-new-york', reason: 'initial' });
  });

  it('respects the settings toggle', () => {
    expect(decideAutoDownload(ctx({ enabled: false }))).toEqual({
      start: false,
      reason: 'disabled',
    });
  });

  it('does nothing outside any known region', () => {
    expect(decideAutoDownload(ctx({ regionId: null }))).toEqual({
      start: false,
      reason: 'no-region',
    });
  });

  it('skips regions already downloaded or downloading', () => {
    expect(decideAutoDownload(ctx({ downloaded: true }))).toEqual({
      start: false,
      reason: 'already-downloaded',
    });
    expect(decideAutoDownload(ctx({ downloading: true }))).toEqual({
      start: false,
      reason: 'already-downloading',
    });
  });

  it('waits for the viewport to settle', () => {
    expect(decideAutoDownload(ctx({ settled: false }))).toEqual({
      start: false,
      reason: 'not-settled',
    });
  });

  it('requires free space for the pack plus its expanded tree', () => {
    const packSizeBytes = 200 * 1024 * 1024;
    const needed = packSizeBytes * AUTO_DOWNLOAD_DISK_HEADROOM;

    expect(decideAutoDownload(ctx({ packSizeBytes, freeBytes: needed - 1 }))).toEqual({
      start: false,
      reason: 'insufficient-disk',
    });
    expect(decideAutoDownload(ctx({ packSizeBytes, freeBytes: needed })).start).toBe(true);
  });

  it('has no fixed size ceiling — a large pack fits when the disk does', () => {
    // 600 MB is far past the old 150 MB cap; it is allowed now that the unpacker
    // streams and the check is real free space.
    const packSizeBytes = 600 * 1024 * 1024;
    expect(decideAutoDownload(ctx({ packSizeBytes, freeBytes: 64 * 1024 ** 3 })).start).toBe(true);
  });

  it('skips when the pack size is unknown', () => {
    expect(decideAutoDownload(ctx({ packSizeBytes: null }))).toEqual({
      start: false,
      reason: 'size-unknown',
    });
  });

  it('skips when free space cannot be read', () => {
    expect(decideAutoDownload(ctx({ freeBytes: null }))).toEqual({
      start: false,
      reason: 'disk-unknown',
    });
  });

  it('refuses cellular unless the user opted in', () => {
    expect(decideAutoDownload(ctx({ metered: true }))).toEqual({ start: false, reason: 'metered' });
    expect(decideAutoDownload(ctx({ metered: true, allowMetered: true })).start).toBe(true);
  });

  it('does not retry a region that already failed this session', () => {
    expect(decideAutoDownload(ctx({ attempts: AUTO_DOWNLOAD_MAX_ATTEMPTS }))).toEqual({
      start: false,
      reason: 'attempted',
    });
  });
});

describe('describeDecision', () => {
  it('names the region when starting', () => {
    expect(describeDecision(decideAutoDownload(ctx()))).toContain('us-new-york');
  });

  it('reports the skip reason otherwise', () => {
    expect(describeDecision(decideAutoDownload(ctx({ metered: true })))).toContain('metered');
  });
});
