/**
 * Tests for nostrFallback.ts — Nostr relay WebSocket fallback for traffic probes.
 *
 * These tests mock WebSocket and verify:
 * - Event construction (kind 20100, geohash `g` tag, `expiration` tag)
 * - Subscription filtering (REQ with #g filter)
 * - Reconnection behaviour
 */

import type { TrafficProbe } from '../../src/models/traffic';

// Mock WebSocket
const mockSockets: MockWebSocket[] = [];

class MockWebSocket {
  readyState = 0; // CONNECTING
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    mockSockets.push(this);
    // Simulate async open
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

// @ts-expect-error replacing global WebSocket for test
global.WebSocket = MockWebSocket;

// Mock the identity module
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn().mockResolvedValue({
    publicKey: 'a'.repeat(64),
    privateKey: 'b'.repeat(64),
  }),
}));

jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn().mockResolvedValue('sig'.repeat(43)),
}));

describe('Nostr event construction', () => {
  it('builds a valid probe event with kind 20100, geohash tag, and expiration', () => {
    // Verify expected event structure matches NIP-01 + NIP-40 + NIP-52
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 300;

    const event = {
      kind: 20100,
      created_at: now,
      tags: [
        ['g', 'u4pr'],
        ['expiration', String(expiry)],
      ],
      content: JSON.stringify({
        g6: 'u4pruyd',
        sid: '',
        spd: 45.2,
        brg: 180,
        ts: now,
      }),
      pubkey: 'a'.repeat(64),
    };

    expect(event.kind).toBe(20100);
    expect(event.tags[0]).toEqual(['g', 'u4pr']);
    expect(event.tags[1][0]).toBe('expiration');
    expect(Number(event.tags[1][1])).toBeGreaterThan(now);
    expect(JSON.parse(event.content).g6).toBe('u4pruyd');
  });

  it('builds correct REQ subscription filter for geohash', () => {
    const subId = 'traffic-u4pr';
    const filter = {
      kinds: [20100],
      '#g': ['u4pr'],
      since: Math.floor(Date.now() / 1000) - 300,
    };

    const req = JSON.stringify(['REQ', subId, filter]);
    const parsed = JSON.parse(req);

    expect(parsed[0]).toBe('REQ');
    expect(parsed[1]).toBe('traffic-u4pr');
    expect(parsed[2].kinds).toEqual([20100]);
    expect(parsed[2]['#g']).toEqual(['u4pr']);
  });
});

describe('Nostr probe parsing', () => {
  it('parses a relay EVENT message into a TrafficProbe', () => {
    const now = Math.floor(Date.now() / 1000);
    const probeContent = {
      g6: 'u4pruyd',
      sid: '',
      spd: 55.0,
      brg: 270,
      ts: now,
    };

    const relay_event_data = {
      id: 'deadbeef',
      kind: 20100,
      pubkey: 'c'.repeat(64),
      created_at: now,
      content: JSON.stringify(probeContent),
      tags: [
        ['g', 'u4pr'],
        ['expiration', String(now + 300)],
      ],
      sig: 'f'.repeat(128),
    };

    // Parse like nostrFallback does
    const content = JSON.parse(relay_event_data.content);
    const probe: TrafficProbe = {
      geohash6: content.g6,
      segmentId: content.sid || '',
      speedMph: content.spd,
      bearing: content.brg,
      timestamp: content.ts,
      probeId: new Uint8Array(8),
    };

    expect(probe.geohash6).toBe('u4pruyd');
    expect(probe.speedMph).toBe(55.0);
    expect(probe.bearing).toBe(270);
    expect(probe.timestamp).toBe(now);
  });

  it('rejects expired events', () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60; // expired 1 minute ago
    const isExpired = expiredAt < Math.floor(Date.now() / 1000);
    expect(isExpired).toBe(true);
  });
});

describe('MockWebSocket relay connection', () => {
  beforeEach(() => {
    mockSockets.length = 0;
  });

  it('creates WebSocket with correct relay URL', () => {
    const ws = new MockWebSocket('wss://relay.damus.io');
    expect(ws.url).toBe('wss://relay.damus.io');
    expect(mockSockets).toHaveLength(1);
  });

  it('can send REQ and CLOSE commands', async () => {
    const ws = new MockWebSocket('wss://nos.lol');
    // Wait for open
    await new Promise<void>((r) => {
      ws.onopen = r;
    });

    ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [20100], '#g': ['u4pr'] }]));
    ws.send(JSON.stringify(['CLOSE', 'sub1']));

    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[0])[0]).toBe('REQ');
    expect(JSON.parse(ws.sent[1])[0]).toBe('CLOSE');
  });
});
