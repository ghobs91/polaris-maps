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
import { MIN_PEER_THRESHOLD } from '../../src/models/traffic';

describe('selectProbeTransport', () => {
  it('uses Hyperswarm when started with enough peers', () => {
    expect(selectProbeTransport(true, MIN_PEER_THRESHOLD)).toBe('hyperswarm');
    expect(selectProbeTransport(true, 12)).toBe('hyperswarm');
  });

  it('falls back to Nostr when the swarm has not started', () => {
    expect(selectProbeTransport(false, 12)).toBe('nostr');
  });

  it('falls back to Nostr below the peer threshold', () => {
    expect(selectProbeTransport(true, MIN_PEER_THRESHOLD - 1)).toBe('nostr');
    expect(selectProbeTransport(true, 0)).toBe('nostr');
  });
});
