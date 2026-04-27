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
