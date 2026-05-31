import { fetchWmataLines, clearWmataCache } from '../../src/services/transit/wmataFetcher';

describe('wmataFetcher', () => {
  const mockFetch = jest.fn();
  (global as any).fetch = mockFetch;

  beforeEach(() => {
    mockFetch.mockReset();
    clearWmataCache();
    delete (process.env as any).EXPO_PUBLIC_WMATA_API_KEY;
  });

  const makeLine = (code: string, name: string) => ({
    Lines: [
      {
        LineCode: code,
        DisplayName: name,
        InternalDestination1: 'End 1',
        InternalDestination2: 'End 2',
      },
    ],
  });

  const makeStations = (...codes: string[]) => ({
    Stations: codes.map((c, i) => ({
      Code: c,
      Name: `${c} Station`,
      Lat: 38.9 + i * 0.01,
      Lon: -77.0 - i * 0.01,
      LineCode1: 'RD',
    })),
  });

  it('returns empty array when API key is not set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const result = await fetchWmataLines();
    expect(result).toEqual([]);
  });

  it('fetches lines and returns TransitRouteLine[]', async () => {
    (process.env as any).EXPO_PUBLIC_WMATA_API_KEY = 'test-key';

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeLine('RD', 'Red Line'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeStations('A01', 'A02', 'A03'),
      });

    const result = await fetchWmataLines();
    expect(result.length).toBe(1);
    expect(result[0].ref).toBe('RD');
    expect(result[0].mode).toBe('SUBWAY');
    expect(result[0].stops.length).toBe(3);
    expect(result[0].geometry[0].length).toBeGreaterThanOrEqual(2);
  });

  it('caches result and returns from cache on subsequent calls', async () => {
    (process.env as any).EXPO_PUBLIC_WMATA_API_KEY = 'test-key';

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => makeLine('BL', 'Blue Line') })
      .mockResolvedValueOnce({ ok: true, json: async () => makeStations('B01', 'B02') });

    const first = await fetchWmataLines();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const second = await fetchWmataLines();
    expect(mockFetch).toHaveBeenCalledTimes(2); // no additional calls
    expect(second).toBe(first);
  });

  it('handles API errors gracefully', async () => {
    (process.env as any).EXPO_PUBLIC_WMATA_API_KEY = 'test-key';
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchWmataLines();
    expect(result).toEqual([]);
  });
});
