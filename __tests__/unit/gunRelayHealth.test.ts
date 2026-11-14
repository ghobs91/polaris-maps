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
  isRelayHealthStale,
  primeRelayHealth,
  probeRelay,
  probeRelays,
  resolveRelayPeers,
  selectRelayPeers,
  toWebSocketUrl,
  type ProbeSocket,
} from '../../src/services/gun/relayHealth';

const SEEDS = ['https://a.example.org/gun', 'https://b.example.org/gun'];

/**
 * A scriptable stand-in for the global WebSocket.
 *
 * The probe is event-driven, so the test drives the lifecycle explicitly
 * instead of faking a promise — that keeps the "dead relay" cases honest.
 */
class FakeSocket implements ProbeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  // Driver helpers
  open(): void {
    this.onopen?.();
  }
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
  fail(): void {
    this.onerror?.();
  }
  drop(): void {
    this.onclose?.();
  }
}

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

describe('toWebSocketUrl', () => {
  it('upgrades http(s) to the WebSocket scheme Gun needs', () => {
    expect(toWebSocketUrl('https://a.example.org/gun')).toBe('wss://a.example.org/gun');
    expect(toWebSocketUrl('http://a.example.org/gun')).toBe('ws://a.example.org/gun');
  });

  it('leaves an explicit ws(s) URL alone', () => {
    expect(toWebSocketUrl('wss://a.example.org/gun')).toBe('wss://a.example.org/gun');
    expect(toWebSocketUrl('ws://a.example.org/gun')).toBe('ws://a.example.org/gun');
  });
});

describe('probeRelay', () => {
  /**
   * Regression: a deleted Heroku app still answers `404` with an HTML page. The
   * old probe counted any status below 500 as healthy, so three dead seeds could
   * never be evicted. Health now requires the Gun wire protocol, which an HTML
   * 404 cannot produce.
   */
  it('rejects a host that cannot complete the handshake', async () => {
    const socket = new FakeSocket('wss://dead.example.org/gun');
    const result = probeRelay('https://dead.example.org/gun', {
      socketFactory: () => socket,
    });
    socket.fail();
    await expect(result).resolves.toBe(false);
  });

  it('accepts a relay that greets with a Gun frame', async () => {
    const socket = new FakeSocket('wss://live.example.org/gun');
    const result = probeRelay('https://live.example.org/gun', {
      socketFactory: () => socket,
    });
    socket.open();
    socket.emit('{"#":"abc","dam":"?","pid":"xyz"}');
    await expect(result).resolves.toBe(true);
    expect(socket.closed).toBe(true);
  });

  it('sends a get on open so a quiet relay still answers', async () => {
    const socket = new FakeSocket('wss://quiet.example.org/gun');
    const result = probeRelay('https://quiet.example.org/gun', {
      socketFactory: () => socket,
    });
    socket.open();
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({ get: { 'polaris-probe': { '#': 'x' } } });
    socket.emit('{}');
    await expect(result).resolves.toBe(true);
  });

  it('reports a relay that closes without a frame as unhealthy', async () => {
    const socket = new FakeSocket('wss://flaky.example.org/gun');
    const result = probeRelay('https://flaky.example.org/gun', {
      socketFactory: () => socket,
    });
    socket.open();
    socket.drop();
    await expect(result).resolves.toBe(false);
  });

  it('gives up on a relay that never answers', async () => {
    const socket = new FakeSocket('wss://slow.example.org/gun');
    await expect(
      probeRelay('https://slow.example.org/gun', { socketFactory: () => socket, timeoutMs: 5 }),
    ).resolves.toBe(false);
  });

  it('reports a throwing socket constructor as unhealthy', async () => {
    await expect(
      probeRelay('https://boom.example.org/gun', {
        socketFactory: () => {
          throw new Error('bad url');
        },
      }),
    ).resolves.toBe(false);
  });
});

describe('probeRelays', () => {
  it('keeps only the relays that completed a handshake, preserving order', async () => {
    const sockets: FakeSocket[] = [];
    const socketFactory = (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    };

    const pending = probeRelays(
      [
        'https://dead.one/gun',
        'https://alive.one/gun',
        'https://dead.two/gun',
        'https://alive.two/gun',
      ],
      { socketFactory },
    );

    // Let every probe register its handlers before driving them.
    await Promise.resolve();
    for (const socket of sockets) {
      if (socket.url.includes('dead')) socket.fail();
      else {
        socket.open();
        socket.emit('{"dam":"?"}');
      }
    }

    // Survivors keep the spelling they were configured with, so the cached set
    // round-trips through MMKV unchanged; only the socket sees the ws(s) form.
    await expect(pending).resolves.toEqual(['https://alive.one/gun', 'https://alive.two/gun']);
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
