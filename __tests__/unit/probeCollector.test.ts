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
jest.mock('expo-location', () => ({
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 6 },
}));
jest.mock('../../src/services/traffic/hyperswarmBridge', () => ({
  isStarted: jest.fn(),
  publishProbe: jest.fn(),
}));
jest.mock('../../src/services/traffic/nostrFallback', () => ({
  publishProbe: jest.fn(),
}));

import { selectProbeTransport } from '../../src/services/traffic/probeCollector';

describe('selectProbeTransport', () => {
  it('uses Hyperswarm while peers are connected', () => {
    expect(selectProbeTransport(true, 1)).toBe('hyperswarm');
    expect(selectProbeTransport(true, 12)).toBe('hyperswarm');
  });

  it('falls back to Nostr when the swarm has not started', () => {
    expect(selectProbeTransport(false, 12)).toBe('nostr');
  });

  it('falls back to Nostr only when the swarm has no peers at all', () => {
    // Scale-safe: one peer is still reachable over the mesh, so probes stay
    // peer-to-peer instead of being broadcast to public relays.
    expect(selectProbeTransport(true, 1)).toBe('hyperswarm');
    expect(selectProbeTransport(true, 0)).toBe('nostr');
  });
});
