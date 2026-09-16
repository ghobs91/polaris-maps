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
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '0'.repeat(32)) }));
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
import { getOrCreateKeypair } from '../../src/services/identity/keypair';
import {
  isStarted,
  publishIncident as hyperswarmPublishIncident,
} from '../../src/services/traffic/hyperswarmBridge';
import { useTrafficStore } from '../../src/stores/trafficStore';
import {
  receiveIncidentWire,
  reportIncident,
  resetIncidentExchangeState,
} from '../../src/services/traffic/incidentExchangeService';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * End-to-end P2P loop without a second device: node A reports and the wire
 * frame it broadcasts is fed to node B's receive path, which verifies it and
 * populates the store that drives the map layer and nav banner.
 */
describe('incident report → broadcast → receive → store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetIncidentExchangeState();
    const privateKey = schnorr.utils.randomPrivateKey();
    const publicKey = bytesToHex(schnorr.getPublicKey(privateKey));
    (getOrCreateKeypair as jest.Mock).mockResolvedValue({ privateKey, publicKey });
    (isStarted as jest.Mock).mockReturnValue(true);
    useTrafficStore.setState({ incidents: [], swarmPeerCount: 5 });
  });

  it('accepts a broadcast report on a receiving node', async () => {
    await reportIncident(40.7, -74.0, 'accident', 'two-car collision');

    expect(hyperswarmPublishIncident).toHaveBeenCalledTimes(1);
    const wire = (hyperswarmPublishIncident as jest.Mock).mock.calls[0][0];
    expect(typeof wire).toBe('string');

    // Simulate a distinct receiving node: no prior dedupe/rate-limit state.
    useTrafficStore.setState({ incidents: [] });
    resetIncidentExchangeState();

    expect(receiveIncidentWire(wire)).toBe(true);
    const incidents = useTrafficStore.getState().incidents;
    expect(incidents).toHaveLength(1);
    expect(incidents[0].type).toBe('accident');
    expect(incidents[0].description).toBe('two-car collision');
  });
});
