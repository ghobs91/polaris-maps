jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000000000000000000000000000'),
}));

jest.mock('../../src/services/traffic/hyperswarmBridge', () => ({
  publishIncident: jest.fn(),
  isStarted: jest.fn(),
  onIncident: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/services/traffic/nostrFallback', () => ({
  publishIncident: jest.fn(),
  getConnectedRelayCount: jest.fn(),
  onIncident: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/services/sync/offlineQueue', () => ({ enqueue: jest.fn() }));

jest.mock('../../src/services/identity/keypair', () => ({ getOrCreateKeypair: jest.fn() }));

import { schnorr } from '@noble/curves/secp256k1';
import { sign } from '../../src/services/identity/signing';
import { encode as geohashEncode } from '../../src/utils/geohash';
import {
  encodeIncidentWire,
  incidentSigningPayload,
} from '../../src/services/traffic/incidentWire';
import { getOrCreateKeypair } from '../../src/services/identity/keypair';
import {
  isStarted,
  publishIncident as hyperswarmPublishIncident,
} from '../../src/services/traffic/hyperswarmBridge';
import {
  getConnectedRelayCount,
  publishIncident as nostrPublishIncident,
} from '../../src/services/traffic/nostrFallback';
import { enqueue } from '../../src/services/sync/offlineQueue';
import { useTrafficStore } from '../../src/stores/trafficStore';
import { storage } from '../../src/services/storage/mmkv';
import {
  receiveIncidentWire,
  reportIncident,
  resetIncidentExchangeState,
} from '../../src/services/traffic/incidentExchangeService';
import type { TrafficIncident } from '../../src/models/traffic';

let privateKey: Uint8Array;
let publicKey: string;

function freshKeypair(): void {
  privateKey = schnorr.utils.randomPrivateKey();
  publicKey = bytesToHex(schnorr.getPublicKey(privateKey));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function signedIncident(overrides: Partial<TrafficIncident> = {}): Promise<TrafficIncident> {
  const lat = 40.7;
  const lng = -74.0;
  const now = Date.now();
  const base = {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    reporterPubkey: publicKey,
    lat,
    lng,
    geohash6: geohashEncode(lat, lng, 6),
    type: 'hazard' as const,
    description: 'debris',
    reportedAt: now,
    expiresAt: now + 3_600_000,
    ...overrides,
  };
  const signatureHex = await sign(incidentSigningPayload(base), privateKey);
  return { ...base, signature: hexToBytes(signatureHex) };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetIncidentExchangeState();
  freshKeypair();
  (getOrCreateKeypair as jest.Mock).mockResolvedValue({ privateKey, publicKey });
  (isStarted as jest.Mock).mockReturnValue(false);
  (getConnectedRelayCount as jest.Mock).mockReturnValue(0);
  useTrafficStore.setState({ incidents: [], swarmPeerCount: 0 });
});

describe('incident receipt', () => {
  it('accepts and persists a valid incident', async () => {
    const incident = await signedIncident();

    expect(receiveIncidentWire(encodeIncidentWire(incident))).toBe(true);
    expect(useTrafficStore.getState().incidents).toHaveLength(1);
    expect(storage.set).toHaveBeenCalledWith('traffic_incidents', expect.any(String));
  });

  it('rejects a duplicate incident id', async () => {
    const incident = await signedIncident();
    receiveIncidentWire(encodeIncidentWire(incident));

    expect(receiveIncidentWire(encodeIncidentWire(incident))).toBe(false);
    expect(useTrafficStore.getState().incidents).toHaveLength(1);
  });

  it('rejects an invalid signature', async () => {
    const incident = await signedIncident();
    incident.signature[0] ^= 0xff;

    expect(receiveIncidentWire(encodeIncidentWire(incident))).toBe(false);
    expect(useTrafficStore.getState().incidents).toHaveLength(0);
  });

  it('rejects an expired incident', async () => {
    const incident = await signedIncident({ expiresAt: Date.now() - 1_000 });
    expect(receiveIncidentWire(encodeIncidentWire(incident))).toBe(false);
  });

  it('rejects a geohash that does not match the coordinates', async () => {
    const incident = await signedIncident({ lat: 41.5 });
    expect(receiveIncidentWire(encodeIncidentWire(incident))).toBe(false);
  });

  it('rejects an over-long description', async () => {
    const incident = await signedIncident({ description: 'x'.repeat(201) });
    expect(receiveIncidentWire(encodeIncidentWire(incident))).toBe(false);
  });

  it('rate-limits rapid reports from the same reporter', async () => {
    const first = await signedIncident();
    const second = await signedIncident();

    expect(receiveIncidentWire(encodeIncidentWire(first))).toBe(true);
    expect(receiveIncidentWire(encodeIncidentWire(second))).toBe(false);
    expect(useTrafficStore.getState().incidents).toHaveLength(1);
  });
});

describe('incident reporting transport selection', () => {
  it('broadcasts over Hyperswarm when enough peers are present', async () => {
    (isStarted as jest.Mock).mockReturnValue(true);
    useTrafficStore.setState({ swarmPeerCount: 5 });

    await reportIncident(40.7, -74.0, 'hazard', 'debris');

    expect(hyperswarmPublishIncident).toHaveBeenCalledTimes(1);
    expect(nostrPublishIncident).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('falls back to Nostr when the swarm has too few peers', async () => {
    (isStarted as jest.Mock).mockReturnValue(false);
    (getConnectedRelayCount as jest.Mock).mockReturnValue(2);

    await reportIncident(40.7, -74.0, 'hazard', 'debris');

    expect(hyperswarmPublishIncident).not.toHaveBeenCalled();
    expect(nostrPublishIncident).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues for replay when no transport is available', async () => {
    await reportIncident(40.7, -74.0, 'hazard', 'debris');

    expect(hyperswarmPublishIncident).not.toHaveBeenCalled();
    expect(nostrPublishIncident).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith({ type: 'incident', payload: expect.any(String) });
  });
});
