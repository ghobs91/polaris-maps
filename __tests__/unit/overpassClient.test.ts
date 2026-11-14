/**
 * Overpass fallback policy.
 *
 * The fallback talks to volunteer-run public mirrors, so the contract under
 * test is as much about politeness as correctness: no hedging, mirror cooldown,
 * one request in flight, identifiable UA, and a kill switch.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import {
  OVERPASS_MIRRORS,
  OVERPASS_USER_AGENT,
  OverpassDisabledError,
  OverpassUnavailableError,
  __resetOverpassPolicyForTests,
  __setOverpassClockForTests,
  __setOverpassMinIntervalMsForTests,
  isOverpassEnabled,
  overpassFetch,
  setOverpassEnabled,
} from '../../src/services/overpassClient';

const PRIMARY = OVERPASS_MIRRORS[0];
const SECONDARY = OVERPASS_MIRRORS[1];

let now = 1_000_000;

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function statusResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

beforeEach(() => {
  mockFetch.mockReset();
  __resetOverpassPolicyForTests();
  __setOverpassMinIntervalMsForTests(0);
  now = 1_000_000;
  __setOverpassClockForTests(() => now);
});

describe('overpassFetch mirror policy', () => {
  it('asks only the first mirror when it answers (no hedging)', async () => {
    const payload = { elements: [{ type: 'node', id: 1 }] };
    mockFetch.mockResolvedValue(okResponse(payload));

    const result = await overpassFetch({ query: 'test', timeoutMs: 5_000 });

    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0]).toBe(PRIMARY);
  });

  it('falls back to the next mirror, in order, when the first fails', async () => {
    mockFetch
      .mockResolvedValueOnce(statusResponse(500))
      .mockResolvedValueOnce(okResponse({ elements: [] }));

    const result = await overpassFetch({ query: 'test', timeoutMs: 5_000 });

    expect(result).toEqual({ elements: [] });
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([PRIMARY, SECONDARY]);
  });

  it('puts a rate-limited mirror into cooldown and skips it next time', async () => {
    // Primary rate-limits; the request succeeds on the next mirror.
    mockFetch.mockResolvedValueOnce(statusResponse(429));
    mockFetch.mockResolvedValue(okResponse({ elements: [] }));

    await overpassFetch({ query: 'test', timeoutMs: 5_000 });
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([PRIMARY, SECONDARY]);

    mockFetch.mockClear();
    await overpassFetch({ query: 'test', timeoutMs: 5_000 });

    // The 429'd mirror must not be contacted again while cooling down.
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([SECONDARY]);
  });

  it('lets a mirror back in once its cooldown expires', async () => {
    mockFetch.mockResolvedValueOnce(statusResponse(429));
    await expect(overpassFetch({ query: 'test', timeoutMs: 5_000 })).rejects.toThrow();

    now += 11 * 60_000; // past the maximum cooldown
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okResponse({ elements: [] }));

    await overpassFetch({ query: 'test', timeoutMs: 5_000 });
    expect(mockFetch.mock.calls[0]![0]).toBe(PRIMARY);
  });

  it('fails fast with a retry hint when every mirror is cooling down', async () => {
    mockFetch.mockResolvedValue(statusResponse(429));
    await expect(overpassFetch({ query: 'test', timeoutMs: 5_000 })).rejects.toThrow();

    mockFetch.mockReset();
    const err = await overpassFetch({ query: 'test', timeoutMs: 5_000 }).catch((e) => e);

    expect(err).toBeInstanceOf(OverpassUnavailableError);
    expect((err as OverpassUnavailableError).retryAt).toBeGreaterThan(now);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never has two requests in flight at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockFetch.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return okResponse({ elements: [] });
    });

    await Promise.all([
      overpassFetch({ query: 'a', timeoutMs: 5_000 }),
      overpassFetch({ query: 'b', timeoutMs: 5_000 }),
      overpassFetch({ query: 'c', timeoutMs: 5_000 }),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it('propagates a caller abort without touching other mirrors', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => {
      controller.abort();
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    });

    await expect(
      overpassFetch({ query: 'test', timeoutMs: 5_000, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not start a request for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      overpassFetch({ query: 'test', timeoutMs: 5_000, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('treats a timeout as a mirror failure, not a caller abort', async () => {
    mockFetch.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    mockFetch.mockResolvedValueOnce(okResponse({ elements: ['secondary'] }));

    const result = await overpassFetch({ query: 'test', timeoutMs: 5 });

    expect(result).toEqual({ elements: ['secondary'] });
    expect(mockFetch.mock.calls[1]![0]).toBe(SECONDARY);
  });

  it('identifies the app with a contactable User-Agent', async () => {
    mockFetch.mockResolvedValue(okResponse({ elements: [] }));

    await overpassFetch({ query: '[out:json];node(1);out;', timeoutMs: 5_000 });

    const [, init] = mockFetch.mock.calls[0] as [
      string,
      { method: string; body: string; headers: Record<string, string> },
    ];
    expect(init.method).toBe('POST');
    expect(init.headers['User-Agent']).toBe(OVERPASS_USER_AGENT);
    expect(init.body).toContain('data=%5Bout%3Ajson%5D%3Bnode(1)%3Bout%3B');
  });
});

describe('overpass kill switch', () => {
  it('refuses to make requests when disabled', async () => {
    setOverpassEnabled(false);
    expect(isOverpassEnabled()).toBe(false);

    await expect(overpassFetch({ query: 'test', timeoutMs: 5_000 })).rejects.toBeInstanceOf(
      OverpassDisabledError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('resumes when re-enabled', async () => {
    setOverpassEnabled(false);
    setOverpassEnabled(true);
    mockFetch.mockResolvedValue(okResponse({ elements: [] }));

    await expect(overpassFetch({ query: 'test', timeoutMs: 5_000 })).resolves.toEqual({
      elements: [],
    });
  });
});
