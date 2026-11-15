/**
 * Progress-stage labels and the indeterminate "finishing" rule.
 *
 * The bar used to freeze at "Downloading map tiles… 100%" for minutes while the
 * archive expanded with no bytes transferred, which read as a hang — and the
 * expansion did hang once, past its RPC timeout, so the difference matters.
 */

import { downloadStageLabel, isFinishing } from '../../src/components/regions/DownloadProgressBar';
import type { DownloadProgress } from '../../src/services/regions/downloadService';

const progress = (overrides: Partial<DownloadProgress>): DownloadProgress => ({
  regionId: 'us-ny-new-york',
  totalBytes: 100,
  downloadedBytes: 100,
  percent: 100,
  stage: 'tiles',
  ...overrides,
});

describe('downloadStageLabel', () => {
  it('labels every stage, including the expansion', () => {
    expect(downloadStageLabel(progress({ stage: 'tiles', percent: 40 }))).toContain('tiles');
    expect(downloadStageLabel(progress({ stage: 'unpack' }))).toContain('Expanding');
    expect(downloadStageLabel(progress({ stage: 'indices', percent: 10 }))).toContain('search');
    expect(downloadStageLabel(progress({ stage: 'complete' }))).toContain('complete');
  });

  it('surfaces the error message', () => {
    const label = downloadStageLabel(progress({ stage: 'error', error: 'connection lost' }));
    expect(label).toContain('connection lost');
  });

  it('has a fallback when the error carries no message', () => {
    expect(downloadStageLabel(progress({ stage: 'error' }))).toContain('failed');
  });
});

describe('isFinishing', () => {
  it('is true during the expansion and after any transfer reaches 100%', () => {
    // The frozen-100% hang: stage still 'tiles', percent already 100.
    expect(isFinishing(progress({ stage: 'unpack' }))).toBe(true);
    expect(isFinishing(progress({ stage: 'tiles', percent: 100 }))).toBe(true);
  });

  it('is false while bytes are still moving', () => {
    expect(isFinishing(progress({ stage: 'tiles', percent: 51 }))).toBe(false);
  });

  it('is false for terminal stages', () => {
    expect(isFinishing(progress({ stage: 'complete' }))).toBe(false);
    expect(isFinishing(progress({ stage: 'error' }))).toBe(false);
  });
});
