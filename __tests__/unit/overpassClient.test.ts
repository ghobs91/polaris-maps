import { overpassFetch } from '../../src/services/overpassClient';

// ---------------------------------------------------------------------------
// Mocking fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// overpassFetch — parallel hedging behaviour
// ---------------------------------------------------------------------------

describe('overpassFetch', () => {
  const sampleResponse = { elements: [{ type: 'node', id: 1 }] };

  it('returns data when at least one instance succeeds', async () => {
    // All three instances called in parallel — first one resolves fine
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => sampleResponse,
    });

    const result = await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    expect(result).toEqual(sampleResponse);
    // All 3 instances are called in parallel
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('resolves with the first successful response when others fail', async () => {
    // Instance 1: fail, Instance 2: succeed, Instance 3: fail
    mockFetch
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleResponse,
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    expect(result).toEqual(sampleResponse);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws AggregateError when all instances fail', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  it('throws when all instances have network errors', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('instance1 down'))
      .mockRejectedValueOnce(new Error('instance2 down'))
      .mockRejectedValueOnce(new Error('instance3 down'));

    await expect(
      overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  it('sends the query as GET with URL-encoded data parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    });

    await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('data=%5Bout%3Ajson%5D%3Bnode(1)%3Bout%3B');
    expect(url).toContain('overpass');
  });

  it('calls all three known Overpass instances', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => sampleResponse,
    });

    await overpassFetch({ query: 'test', timeoutMs: 5000 });

    const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
    expect(urls).toContain('https://overpass-api.de/api/interpreter?data=test');
    expect(urls).toContain('https://overpass.private.coffee/api/interpreter?data=test');
    expect(urls).toContain('https://overpass.openstreetmap.fr/api/interpreter?data=test');
  });
});
