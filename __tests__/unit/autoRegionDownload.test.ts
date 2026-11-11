/**
 * Auto region download policy.
 *
 * Downloading a few hundred megabytes without being asked is hostile, so the
 * decision is conservative: enabled, inside a known region, not already
 * downloaded/downloading, under the size cap, unmetered unless opted in, and
 * only after the viewport settles.
 */

import {
  AUTO_DOWNLOAD_MAX_BYTES,
  AUTO_DOWNLOAD_MAX_ATTEMPTS,
  decideAutoDownload,
  describeDecision,
  type AutoDownloadContext,
} from '../../src/services/regions/autoRegionDownload';

const BASE: AutoDownloadContext = {
  enabled: true,
  regionId: 'us-new-york',
  packSizeBytes: 40 * 1024 * 1024,
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

  it('never auto-downloads a pack above the size cap', () => {
    expect(decideAutoDownload(ctx({ packSizeBytes: AUTO_DOWNLOAD_MAX_BYTES + 1 }))).toEqual({
      start: false,
      reason: 'too-large',
    });
    expect(decideAutoDownload(ctx({ packSizeBytes: AUTO_DOWNLOAD_MAX_BYTES })).start).toBe(true);
  });

  it('treats an unknown pack size as too large', () => {
    expect(decideAutoDownload(ctx({ packSizeBytes: null }))).toEqual({
      start: false,
      reason: 'too-large',
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
