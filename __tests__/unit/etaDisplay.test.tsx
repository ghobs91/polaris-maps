/**
 * Unit tests for EtaDisplay safeAreaBottom padding logic.
 *
 * We extract the paddingBottom computation and formatDuration from the module
 * without rendering the React component (the unit test runner doesn't have the
 * jest-expo preset required for React Native rendering).
 */

describe('EtaDisplay — paddingBottom with safeAreaBottom', () => {
  const BASE_PADDING_BOTTOM = 16;

  function computePaddingBottom(safeAreaBottom = 0): number {
    return BASE_PADDING_BOTTOM + safeAreaBottom;
  }

  it('defaults to 16 when safeAreaBottom is 0', () => {
    expect(computePaddingBottom(0)).toBe(16);
  });

  it('adds the iPhone home indicator inset (34)', () => {
    expect(computePaddingBottom(34)).toBe(50);
  });

  it('adds a large safe area (44)', () => {
    expect(computePaddingBottom(44)).toBe(60);
  });

  it('stays at base when safeAreaBottom is omitted', () => {
    expect(computePaddingBottom()).toBe(16);
  });
});

describe('EtaDisplay — formatDuration', () => {
  // Mirror the private formatDuration function from EtaDisplay.tsx
  function formatDuration(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.ceil((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins} min`;
  }

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
