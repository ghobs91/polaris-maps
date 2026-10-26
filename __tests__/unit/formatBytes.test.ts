import { formatBytes } from '../../src/utils/formatBytes';

describe('formatBytes', () => {
  it('formats zero and invalid values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });

  it('formats bytes, kilobytes, megabytes and gigabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});
