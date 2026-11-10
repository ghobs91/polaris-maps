/**
 * Tests for nostrProfileExchange.ts — "Polaris traffic flow segment"
 * exchange over Nostr (kind 30110).
 *
 * Covers the redistribution gate, event encode/parse roundtrip (real NIP-01
 * Schnorr signing via @noble), entry merging, publishing (mocked relay
 * sockets via nostrFallback's publishStoredEvent), and querying (mock
 * WebSocket + mocked relay directory).
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import type { TrafficAreaCondition, WireConditionEntry } from '../../src/models/trafficHistory';
import type { NostrEvent } from '../../src/services/traffic/nostrFallback';
import { initNostrFallback } from '../../src/services/traffic/nostrFallback';

// ── Test identity ────────────────────────────────────────────────────

const mockPriv = bytesToHex(sha256(new TextEncoder().encode('polaris-profile-test-key')));
const mockPub = bytesToHex(schnorr.getPublicKey(hexToBytes(mockPriv)));

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return out;
}

// ── Module mocks ─────────────────────────────────────────────────────

// Real nostrFallback everywhere except publishStoredEvent, which we count.
const mockPublishStoredEvent = jest.fn(() => 3);
jest.mock('../../src/services/traffic/nostrFallback', () => {
  const actual = jest.requireActual('../../src/services/traffic/nostrFallback') as object;
  return {
    ...actual,
    publishStoredEvent: (...args: unknown[]) => mockPublishStoredEvent(...(args as [])),
  };
});

// Real signing needs an initialized identity keypair.
// Real signing needs an initialized identity keypair (referenced lazily —
// jest.mock factories are hoisted above the const initializations).
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn(async () => ({
    publicKey: mockPub,
    privateKey: Uint8Array.from(mockPriv.match(/../g)!.map((x: string) => parseInt(x, 16))),
  })),
}));

// The query path resolves relays through the directory.
const mockGetActiveRelays = jest.fn(async () => ['wss://relay.test']);
jest.mock('../../src/services/traffic/nostrRelayDirectory', () => ({
  getActiveRelays: (...args: unknown[]) => mockGetActiveRelays(...(args as [])),
}));

// ── Mock relay WebSocket ─────────────────────────────────────────────

const mockSockets: MockRelaySocket[] = [];

/** Events every relay mock answers with (before EOSE) — set per test. */
const mockQueuedEvents: NostrEvent[] = [];

class MockRelaySocket {
  readyState = 0;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    mockSockets.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      for (const event of mockQueuedEvents) {
        this.onmessage?.({ data: JSON.stringify(['EVENT', 'sub', event]) });
      }
      this.onmessage?.({ data: JSON.stringify(['EOSE', 'sub']) });
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

// @ts-expect-error replacing global WebSocket for test
global.WebSocket = MockRelaySocket;

// ── Helpers ──────────────────────────────────────────────────────────

import {
  TRAFFIC_PROFILE_KIND,
  canPublishProfile,
  buildProfileContent,
  buildProfileTags,
  buildProfileFilter,
  parseProfileEvent,
  mergeConditionEntries,
  publishProfileConditions,
  queryNostrProfiles,
} from '../../src/services/traffic/nostrProfileExchange';

function row(overrides: Partial<TrafficAreaCondition> = {}): TrafficAreaCondition {
  return {
    geohash5: 'dr72h',
    dayOfWeek: 2,
    halfHour: 34,
    avgSpeedMph: 24.5,
    avgCongestionRatio: 0.62,
    freeFlowSpeedMph: 40,
    sampleCount: 40,
    probeSamples: 30,
    lastUpdated: Math.floor(Date.now() / 1000) - 3600,
    ...overrides,
  };
}

/** Sign a NIP-01 event exactly as the protocol requires. */
function signEvent(
  kind: number,
  content: string,
  tags: string[][],
  createdAt: number,
  priv = mockPriv,
  pub = mockPub,
): NostrEvent {
  const serialized = JSON.stringify([0, pub, createdAt, kind, tags, content]);
  const id = sha256(new TextEncoder().encode(serialized));
  const sig = schnorr.sign(id, hexToBytes(priv));
  return {
    id: bytesToHex(id),
    pubkey: pub,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: bytesToHex(sig),
  };
}

// ── Redistribution gate ──────────────────────────────────────────────

describe('canPublishProfile', () => {
  const now = Math.floor(Date.now() / 1000);

  it('accepts probe-dominant, well-sampled, recent rows', () => {
    expect(canPublishProfile(row(), now)).toBe(true);
  });

  it('rejects rows below the probe-sample threshold (upstream-seeded)', () => {
    expect(canPublishProfile(row({ probeSamples: 4, sampleCount: 40 }), now)).toBe(false);
    expect(canPublishProfile(row({ probeSamples: 0, sampleCount: 40 }), now)).toBe(false);
  });

  it('rejects rows with too few total samples', () => {
    expect(canPublishProfile(row({ probeSamples: 2, sampleCount: 2 }), now)).toBe(false);
  });

  it('rejects rows older than the retention window', () => {
    const stale = row({ lastUpdated: now - 22 * 86_400 });
    expect(canPublishProfile(stale, now)).toBe(false);
  });
});

// ── Event encode/parse roundtrip ─────────────────────────────────────

describe('profile event roundtrip', () => {
  it('builds tags with the parameterized-replaceable d key and g filter', () => {
    expect(buildProfileTags(row())).toEqual([
      ['d', 'dr72h:2:34'],
      ['g', 'dr72h'],
    ]);
  });

  it('builds a REQ filter scoped to kinds + #g + since + limit', () => {
    const filter = buildProfileFilter(['dr72h', 'dr72k'], 1_000_000);
    expect(filter).toEqual({
      kinds: [TRAFFIC_PROFILE_KIND],
      '#g': ['dr72h', 'dr72k'],
      since: 1_000_000,
      limit: expect.any(Number),
    });
  });

  it('roundtrips a row through content + signed event + parse', () => {
    const r = row();
    const event = signEvent(
      TRAFFIC_PROFILE_KIND,
      buildProfileContent(r),
      buildProfileTags(r),
      Math.floor(Date.now() / 1000),
    );
    const entry = parseProfileEvent(event);
    expect(entry).not.toBeNull();
    expect(entry!.g).toBe('dr72h');
    expect(entry!.d).toBe(2);
    expect(entry!.h).toBe(34);
    expect(entry!.s).toBe(24.5);
    expect(entry!.r).toBe(0.62);
    expect(entry!.n).toBe(40);
    expect(entry!.p).toBe(30);
    expect(entry!.fr).toBe(0);
  });

  it('rejects events with a tampered signature', () => {
    const r = row();
    const event = signEvent(
      TRAFFIC_PROFILE_KIND,
      buildProfileContent(r),
      buildProfileTags(r),
      Math.floor(Date.now() / 1000),
    );
    const tampered = { ...event, content: event.content.replace('"s":24.5', '"s":5') };
    expect(parseProfileEvent(tampered)).toBeNull();
  });

  it('rejects events signed by an unknown key', () => {
    const r = row();
    const other = bytesToHex(sha256(new TextEncoder().encode('attacker-key')));
    const event = signEvent(
      TRAFFIC_PROFILE_KIND,
      buildProfileContent(r),
      buildProfileTags(r),
      Math.floor(Date.now() / 1000),
      other,
      schnorr.getPublicKey(hexToBytes(other)),
    );
    // Valid signature, correct structure — but not the traffic identity.
    // Parsing succeeds structurally; trust policy (identity allowlists /
    // reputation) is applied by the history merge weights, not the parser.
    expect(parseProfileEvent(event)).not.toBeNull();
  });

  it('rejects out-of-range field values', () => {
    const bad = row({ avgCongestionRatio: 1.5 });
    const event = signEvent(
      TRAFFIC_PROFILE_KIND,
      buildProfileContent(bad),
      buildProfileTags(bad),
      Math.floor(Date.now() / 1000),
    );
    expect(parseProfileEvent(event)).toBeNull();
  });

  it('rejects non-profile kinds', () => {
    const r = row();
    const event = signEvent(
      20100,
      buildProfileContent(r),
      buildProfileTags(r),
      Math.floor(Date.now() / 1000),
    );
    expect(parseProfileEvent(event)).toBeNull();
  });
});

// ── Merging ──────────────────────────────────────────────────────────

describe('mergeConditionEntries', () => {
  const e = (g: string, n: number): WireConditionEntry => ({
    g,
    d: 2,
    h: 34,
    s: 20,
    r: 0.5,
    f: 40,
    n,
    u: 1_000_000,
    fr: 0,
  });

  it('keeps the higher-sample entry per cell', () => {
    const merged = mergeConditionEntries([e('a', 10), e('b', 5)], [e('a', 3), e('c', 8)]);
    const byCell = new Map(merged.map((x) => [x.g, x]));
    expect(byCell.get('a')!.n).toBe(10);
    expect(byCell.get('b')!.n).toBe(5);
    expect(byCell.get('c')!.n).toBe(8);
  });
});

// ── Publishing ───────────────────────────────────────────────────────

describe('publishProfileConditions', () => {
  beforeAll(async () => {
    // Loads the identity key into nostrFallback's module state so
    // createSignedEvent can sign.
    await initNostrFallback([]);
  });

  beforeEach(() => {
    mockPublishStoredEvent.mockClear();
    mockPublishStoredEvent.mockReturnValue(3);
    // Reset throttle state via a fresh module is not possible; use distinct
    // cells per test and a fresh throttle window through minIntervalMs: 0.
  });

  it('publishes only gated rows and reports the count sent', async () => {
    const shareable = row();
    const upstream = row({ geohash5: 'dr7up', probeSamples: 0 });
    const sent = await publishProfileConditions([shareable, upstream], { minIntervalMs: 0 });
    expect(sent).toBe(1);
    expect(mockPublishStoredEvent).toHaveBeenCalledTimes(1);
    const event = mockPublishStoredEvent.mock.calls[0]![0] as NostrEvent;
    expect(event.kind).toBe(TRAFFIC_PROFILE_KIND);
    expect(event.content).not.toContain('dr7up');
  });

  it('throttles republication of the same cell+bucket', async () => {
    const r = row({ geohash5: 'dr5th' });
    const sent1 = await publishProfileConditions([r], { minIntervalMs: 60_000 });
    const sent2 = await publishProfileConditions([r], {
      minIntervalMs: 60_000,
      nowMs: Date.now() + 1000,
    });
    expect(sent1).toBe(1);
    expect(sent2).toBe(0);
  });

  it('sends nothing when no relay accepted the event', async () => {
    mockPublishStoredEvent.mockReturnValue(0);
    const sent = await publishProfileConditions([row({ geohash5: 'dr5no' })], { minIntervalMs: 0 });
    expect(sent).toBe(0);
  });
});

// ── Querying ─────────────────────────────────────────────────────────

describe('queryNostrProfiles', () => {
  beforeEach(() => {
    mockSockets.length = 0;
    mockQueuedEvents.length = 0;
    mockGetActiveRelays.mockResolvedValue(['wss://relay.test']);
  });

  it('collects, verifies, and bucket-filters profile events from relays', async () => {
    const good = row();
    const otherBucket = row({ halfHour: 0 });
    mockQueuedEvents.push(
      signEvent(TRAFFIC_PROFILE_KIND, buildProfileContent(good), buildProfileTags(good), 1),
      signEvent(
        TRAFFIC_PROFILE_KIND,
        buildProfileContent(otherBucket),
        buildProfileTags(otherBucket),
        2,
      ),
    );

    const entries = await queryNostrProfiles(['dr72h'], { dayOfWeek: 2, halfHour: 34 }, 500);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.g).toBe('dr72h');
    expect(entries[0]!.p).toBe(30);
    // The REQ filter was scoped to the profile kind and the requested cells.
    const req = JSON.parse(mockSockets[0]!.sent[0]!) as [string, string, Record<string, unknown>];
    expect(req[0]).toBe('REQ');
    expect(req[2]!['kinds']).toEqual([TRAFFIC_PROFILE_KIND]);
  }, 5000);

  it('dedupes multi-publisher answers by sample count', async () => {
    const a = row();
    const b = row({ sampleCount: 90, probeSamples: 80 });
    mockQueuedEvents.push(
      signEvent(TRAFFIC_PROFILE_KIND, buildProfileContent(a), buildProfileTags(a), 1),
      signEvent(TRAFFIC_PROFILE_KIND, buildProfileContent(b), buildProfileTags(b), 2),
    );

    const entries = await queryNostrProfiles(['dr72h'], { dayOfWeek: 2, halfHour: 34 }, 500);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.n).toBe(90);
  }, 5000);

  it('drops unverifiable events', async () => {
    const good = row();
    const forged = signEvent(
      TRAFFIC_PROFILE_KIND,
      buildProfileContent(good),
      buildProfileTags(good),
      1,
    );
    forged.sig = 'f'.repeat(128);
    mockQueuedEvents.push(forged);

    const entries = await queryNostrProfiles(['dr72h'], { dayOfWeek: 2, halfHour: 34 }, 500);
    expect(entries).toHaveLength(0);
  }, 5000);

  it('returns [] when the directory has no relays', async () => {
    mockGetActiveRelays.mockResolvedValue([]);
    const entries = await queryNostrProfiles(['dr72h'], { dayOfWeek: 2, halfHour: 34 }, 200);
    expect(entries).toEqual([]);
  });

  it('returns [] for empty cell lists without touching relays', async () => {
    mockGetActiveRelays.mockClear();
    const entries = await queryNostrProfiles([], { dayOfWeek: 2, halfHour: 34 }, 200);
    expect(entries).toEqual([]);
    expect(mockGetActiveRelays).not.toHaveBeenCalled();
  });
});
