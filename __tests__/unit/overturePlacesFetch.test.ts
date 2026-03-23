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
    ...overrides,
  };
}

describe('prefetchOverturePlaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls fetchOverturePlaces with the region bounds and a generous limit', async () => {
    mockFetch.mockResolvedValue([]);

    const region = makeRegion();
    await prefetchOverturePlaces(region);

    expect(mockFetch).toHaveBeenCalledWith(
      32.5, // south (minLat)
      -124.5, // west  (minLng)
      42.0, // north (maxLat)
      -114.1, // east  (maxLng)
      10_000,
    );
  });

  it('reports places progress events', async () => {
    mockFetch.mockResolvedValue(new Array(47).fill({}));

    const progress = jest.fn();
    await prefetchOverturePlaces(makeRegion(), progress);

    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'places', percent: 0 }));
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'places', percent: 100, totalBytes: 47 }),
    );
  });

  it('succeeds when fetchOverturePlaces returns empty (OVERTURE_PLACES_URL unset)', async () => {
    mockFetch.mockResolvedValue([]);

    await expect(prefetchOverturePlaces(makeRegion())).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
