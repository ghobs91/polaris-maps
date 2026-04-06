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
// overpassFetch — failover behaviour
// ---------------------------------------------------------------------------

describe('overpassFetch', () => {
  const sampleResponse = { elements: [{ type: 'node', id: 1 }] };

  it('returns data from the primary instance on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    });

    const result = await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    expect(result).toEqual(sampleResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://overpass-api.de/api/interpreter');
  });

  it('falls back to secondary when primary returns non-OK status', async () => {
    // Primary: 503 Service Unavailable
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    // Fallback: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    });

    const result = await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    expect(result).toEqual(sampleResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('https://overpass-api.de/api/interpreter');
    expect(mockFetch.mock.calls[1][0]).toBe('https://overpass.private.coffee/api/interpreter');
  });

  it('falls back to secondary when primary throws a network error', async () => {
    // Primary: network failure
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
    // Fallback: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    });

    const result = await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    expect(result).toEqual(sampleResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws when both instances fail', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(
      overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 }),
    ).rejects.toThrow('Overpass API 503');
  });

  it('throws when both instances have network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('primary down'));
    mockFetch.mockRejectedValueOnce(new Error('fallback down'));

    await expect(
      overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 }),
    ).rejects.toThrow('fallback down');
  });

  it('does not retry when the caller aborts via signal', async () => {
    const controller = new AbortController();
    controller.abort();

    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    await expect(
      overpassFetch({
        query: '[out:json];node(1);out;',
        timeoutMs: 5000,
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    // Should NOT have tried the fallback
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends the query as POST with correct content type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ elements: [] }),
    });

    await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5000 });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toBe('data=%5Bout%3Ajson%5D%3Bnode(1)%3Bout%3B');
  });
});
