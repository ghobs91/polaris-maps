// Mock native/expo modules before imports
jest.mock('expo-file-system', () => ({
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  documentDirectory: '/mock/docs/',
}));
jest.mock('expo-sqlite', () => ({}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));
jest.mock('../../src/services/gun/init', () => ({
  getGun: jest.fn(),
}));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn(),
}));
jest.mock('../../src/services/sync/peerService', () => ({
  updatePeerMetrics: jest.fn(),
}));
jest.mock('../../src/services/sync/hyperdriveBridge', () => ({
  downloadFromPeers: jest.fn(),
  seedRegion: jest.fn(),
  unseedRegion: jest.fn(),
}));
jest.mock('react-native', () => ({
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
  NativeModules: {},
}));
jest.mock('../../src/services/poi/overtureFetcher', () => ({
  fetchOverturePlaces: jest.fn(),
}));

import { fetchOverturePlaces } from '../../src/services/poi/overtureFetcher';
import { prefetchOverturePlaces } from '../../src/services/regions/downloadService';
import type { Region } from '../../src/models/region';

const mockFetch = fetchOverturePlaces as jest.MockedFunction<typeof fetchOverturePlaces>;

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'north-america-us-california',
    name: 'California',
    bounds: { minLat: 32.5, maxLat: 42.0, minLng: -124.5, maxLng: -114.1 },
    version: '1.0',
    downloadStatus: 'none',
    tilesSizeBytes: null,
    routingSizeBytes: null,
    geocodingSizeBytes: null,
    downloadedAt: null,
    lastUpdated: null,
    driveKey: null,
    geocodingUrl: null,
    ...overrides,
  };
}

describe('prefetchOverturePlaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not require a live Overture fetch during region download', async () => {
    const region = makeRegion();
    await prefetchOverturePlaces(region);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports places progress events', async () => {
    const progress = jest.fn();
    await prefetchOverturePlaces(makeRegion(), progress);

    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'places', percent: 0 }));
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'places', percent: 100, totalBytes: 0 }),
    );
  });

  it('succeeds without any configured live Overture endpoint', async () => {
    await expect(prefetchOverturePlaces(makeRegion())).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
