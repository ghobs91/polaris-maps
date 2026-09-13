import { formatDuration } from '../../src/utils/units';

describe('EtaDisplay — formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(2760)).toBe('46 min');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(7500)).toBe('2h 5m');
  });

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
  });

  it('rounds up partial minutes', () => {
    expect(formatDuration(61)).toBe('2 min');
  });

  it('handles 0 seconds', () => {
    expect(formatDuration(0)).toBe('0 min');
  });
});
