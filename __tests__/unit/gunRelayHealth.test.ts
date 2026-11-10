/**
 * Gun relay health.
 *
 * The seed list is public community infrastructure the project does not run, so
 * the only things worth testing are: which set gets chosen, and that a probe can
 * only ever *remove* a relay.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockStore = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    delete: (key: string) => mockStore.delete(key),
  })),
}));

import {
  RELAY_HEALTH_TTL_MS,
  __clearRelayHealthForTests,
  getCachedHealthyRelays,
  isHealthyResponse,
  isRelayHealthStale,
  primeRelayHealth,
  probeRelay,
  probeRelays,
  resolveRelayPeers,
  selectRelayPeers,
} from '../../src/services/gun/relayHealth';

const SEEDS = ['https://a.example.org/gun', 'https://b.example.org/gun'];

beforeEach(() => {
  mockStore.clear();
  __clearRelayHealthForTests();
});

describe('selectRelayPeers', () => {
  it('prefers an explicit configuration', () => {
    expect(
      selectRelayPeers({
        env: 'https://custom.one/gun, https://custom.two/gun',
        cachedHealthy: ['https://cached/gun'],
        seeds: SEEDS,
      }),
    ).toEqual(['https://custom.one/gun', 'https://custom.two/gun']);
  });

  it('falls back to the last healthy set', () => {
    expect(selectRelayPeers({ cachedHealthy: ['https://cached/gun'], seeds: SEEDS })).toEqual([
      'https://cached/gun',
    ]);
  });

  it('falls back to the seeds when nothing is known', () => {
    expect(selectRelayPeers({ seeds: SEEDS })).toEqual(SEEDS);
  });

  it('ignores blank entries in the configuration', () => {
    expect(selectRelayPeers({ env: ' , ', cachedHealthy: [], seeds: SEEDS })).toEqual(SEEDS);
  });
});

describe('probeRelay', () => {
  const ok = { status: 200 } as Response;

  it('treats any reachable HTTP response below 500 as healthy', async () => {
    expect(isHealthyResponse(200)).toBe(true);
    expect(isHealthyResponse(403)).toBe(true);
    expect(isHealthyResponse(503)).toBe(false);
    expect(isHealthyResponse(0)).toBe(false);
  });

  it('probes with GET and reports reachability', async () => {
    const fetchImpl = jest.fn(async () => ok);
    await expect(probeRelay('https://a/gun', { fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://a/gun',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports a dead relay as unhealthy', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(probeRelay('https://dead/gun', { fetchImpl })).resolves.toBe(false);
  });

  it('reports an erroring relay as unhealthy', async () => {
    const fetchImpl = jest.fn(async () => ({ status: 502 }) as Response);
    await expect(probeRelay('https://broken/gun', { fetchImpl })).resolves.toBe(false);
  });

  it('aborts a relay that never answers', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      probeRelay('https://slow/gun', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5,
      }),
    ).resolves.toBe(false);
  });
});

describe('probeRelays', () => {
  it('keeps only the relays that answered, preserving order', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('dead')) throw new Error('offline');
      return { status: 200 } as Response;
    });

    const healthy = await probeRelays(
      [
        'https://dead.one/gun',
        'https://alive.one/gun',
        'https://dead.two/gun',
        'https://alive.two/gun',
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(healthy).toEqual(['https://alive.one/gun', 'https://alive.two/gun']);
  });
});

describe('health cache', () => {
  it('is stale before the first probe', () => {
    expect(isRelayHealthStale()).toBe(true);
  });

  it('stores only healthy relays and expires after the TTL', async () => {
    const now = 1_000_000;
    await primeRelayHealth(SEEDS, {
      now: () => now,
      probe: async () => ['https://b.example.org/gun'],
    });

    expect(getCachedHealthyRelays()).toEqual(['https://b.example.org/gun']);
    expect(isRelayHealthStale(now + 1_000)).toBe(false);
    expect(isRelayHealthStale(now + RELAY_HEALTH_TTL_MS + 1)).toBe(true);
  });

  it('does not cache a failed probe as "no relays" in the resolved set', async () => {
    await primeRelayHealth(SEEDS, { probe: async () => [] });

    expect(getCachedHealthyRelays()).toEqual([]);
    // Nothing known healthy means the seeds are used again, not an empty set.
    expect(resolveRelayPeers(SEEDS)).toEqual(SEEDS);
  });

  it('resolves the cached healthy set ahead of the seeds', async () => {
    await primeRelayHealth(SEEDS, { probe: async () => ['https://b.example.org/gun'] });
    expect(resolveRelayPeers(SEEDS)).toEqual(['https://b.example.org/gun']);
  });
});
