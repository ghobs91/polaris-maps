jest.mock('../../src/services/transit/gtfsStaticFetcher', () => ({
  fetchGtfsStaticLines: jest.fn(),
}));

import { fetchGtfsStaticLines } from '../../src/services/transit/gtfsStaticFetcher';
import { fetchWmataLines, clearWmataCache } from '../../src/services/transit/wmataFetcher';

const mockFetchGtfsStaticLines = fetchGtfsStaticLines as jest.MockedFunction<
  typeof fetchGtfsStaticLines
>;

describe('wmataFetcher', () => {
  beforeEach(() => {
    clearWmataCache();
    mockFetchGtfsStaticLines.mockReset();
    delete (process.env as any).EXPO_PUBLIC_WMATA_API_KEY;
  });

  it('returns empty array when API key is not set', async () => {
    const result = await fetchWmataLines();
    expect(result).toEqual([]);
    expect(mockFetchGtfsStaticLines).not.toHaveBeenCalled();
  });

  it('loads route lines from the official GTFS feed', async () => {
    (process.env as any).EXPO_PUBLIC_WMATA_API_KEY = 'test-key';
    mockFetchGtfsStaticLines.mockResolvedValue([
      {
        id: 'gtfs:direct:WMATA Washington DC Metro:RED',
        ref: 'R',
        name: 'Red',
        operator: 'WMATA',
        color: 'C80F2D',
        mode: 'SUBWAY',
        geometry: [
          [
            [-77.1647, 39.12],
            [-77.0536, 39.0618],
          ],
        ],
        stops: [],
      },
    ]);

    const result = await fetchWmataLines();

    expect(result).toHaveLength(1);
    expect(result[0].ref).toBe('R');
    expect(mockFetchGtfsStaticLines).toHaveBeenCalledTimes(1);

    const config = mockFetchGtfsStaticLines.mock.calls[0][0];
    expect(config.feedUrl).toContain('rail-gtfs-static.zip?api_key=test-key');
    expect(config.routeTypeFilter).toEqual([1]);
  });

  it('caches result and returns from cache on subsequent calls', async () => {
    (process.env as any).EXPO_PUBLIC_WMATA_API_KEY = 'test-key';
    mockFetchGtfsStaticLines.mockResolvedValue([]);

    const first = await fetchWmataLines();
    const second = await fetchWmataLines();

    expect(mockFetchGtfsStaticLines).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('handles feed failures gracefully', async () => {
    (process.env as any).EXPO_PUBLIC_WMATA_API_KEY = 'test-key';
    mockFetchGtfsStaticLines.mockRejectedValue(new Error('Network error'));

    const result = await fetchWmataLines();
    expect(result).toEqual([]);
  });
});
