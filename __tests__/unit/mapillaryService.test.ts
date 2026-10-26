const mockUploadAsync = jest.fn();
const mockWriteAsStringAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockNetInfoFetch = jest.fn();
const mockFetch = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  writeAsStringAsync: (...args: unknown[]) => {
    mockWriteAsStringAsync(...args);
    return Promise.resolve();
  },
  deleteAsync: (...args: unknown[]) => {
    mockDeleteAsync(...args);
    return Promise.resolve();
  },
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  dismissBrowser: jest.fn(async () => undefined),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: (...args: unknown[]) => mockNetInfoFetch(...args) },
}));

jest.mock('../../src/services/imagery/streetViewQueue', () => ({
  getOrCreateUploadBatch: jest.fn(),
  getPendingMapillaryCaptures: jest.fn(),
  setCaptureMapillaryStatus: jest.fn(async () => undefined),
  setDriveStatus: jest.fn(async () => undefined),
  updateUploadBatch: jest.fn(async () => undefined),
}));

import type { StreetViewCapture, StreetViewDriveSummary } from '../../src/models/streetViewCapture';
import {
  MapillaryAuthError,
  MapillaryWifiOnlyError,
  uploadDriveToMapillary,
  type MapillaryAuth,
} from '../../src/services/imagery/mapillaryService';

const queue = jest.requireMock('../../src/services/imagery/streetViewQueue') as {
  getOrCreateUploadBatch: jest.Mock;
  getPendingMapillaryCaptures: jest.Mock;
  setCaptureMapillaryStatus: jest.Mock;
  setDriveStatus: jest.Mock;
  updateUploadBatch: jest.Mock;
};

const AUTH: MapillaryAuth = {
  accessToken: 'user-token',
  expiresAt: Date.now() + 60_000,
  username: 'tester',
};

function capture(id: string, width: number, height: number): StreetViewCapture {
  return {
    id,
    driveId: 'drive-1',
    localUri: `file:///captures/${id}.jpg`,
    lat: 40.7,
    lng: -74,
    altitude: null,
    heading: 90,
    speedMps: 10,
    capturedAt: Date.UTC(2026, 9, 23, 14, 0, 0),
    width,
    height,
    bytes: 300_000,
    imageHash: null,
    blurred: false,
    panoramaxStatus: 'pending',
    panoramaxInstance: null,
    panoramaxPictureId: null,
    mapillaryStatus: 'pending',
    mapillaryFileHandle: null,
    mapillaryImageId: null,
    error: null,
    createdAt: Date.UTC(2026, 9, 23, 14, 0, 1),
  };
}

const LANDSCAPE = capture('landscape', 1920, 1080);
const PORTRAIT = capture('portrait', 1080, 1920);

const SUMMARY: StreetViewDriveSummary = {
  drive: {
    id: 'drive-1',
    startedAt: Date.UTC(2026, 9, 23, 13, 55, 0),
    endedAt: Date.UTC(2026, 9, 23, 14, 5, 0),
    status: 'pending',
    captureCount: 2,
    bytes: 600_000,
    error: null,
    createdAt: Date.UTC(2026, 9, 23, 13, 55, 0),
  },
  captures: [LANDSCAPE, PORTRAIT],
  totalBytes: 600_000,
  allLandscape: false,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockNetInfoFetch.mockResolvedValue({ isConnected: true, type: 'wifi' });
  queue.getOrCreateUploadBatch.mockResolvedValue({
    id: 'batch-1',
    driveId: 'drive-1',
    target: 'mapillary',
    remoteBatchId: null,
    status: 'pending',
    total: 0,
    uploaded: 0,
    failed: 0,
    error: null,
    createdAt: 0,
    updatedAt: 0,
  });
  queue.getPendingMapillaryCaptures.mockResolvedValue([LANDSCAPE, PORTRAIT]);
  mockUploadAsync
    .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'image-handle' }) })
    .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'manifest-handle' }) });
  mockFetch.mockResolvedValue(jsonResponse(200, { cluster_id: 'cluster-1' }));
});

describe('uploadDriveToMapillary', () => {
  it('uploads landscape captures, skips portraits, and finishes a cluster', async () => {
    const result = await uploadDriveToMapillary(SUMMARY, AUTH, { wifiOnly: true });

    expect(result).toEqual({
      clusterId: 'cluster-1',
      uploaded: 1,
      failed: 0,
      skipped: 1,
    });

    const imageUpload = mockUploadAsync.mock.calls[0];
    expect(imageUpload[0]).toBe(
      'https://rupload.facebook.com/mapillary_public_uploads/landscape.jpg',
    );
    expect(imageUpload[2]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'OAuth user-token',
          Offset: '0',
          'X-Entity-Name': 'landscape.jpg',
        }),
      }),
    );

    expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
      expect.stringContaining('mapillary-manifest-'),
      JSON.stringify({
        version: '1',
        upload_type: 'images',
        image_handles: ['image-handle'],
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.mapillary.com/finish_upload',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          file_handle: 'manifest-handle',
          file_type: 'mly_bundle_manifest',
        }),
      }),
    );
    expect(queue.setCaptureMapillaryStatus).toHaveBeenCalledWith(
      PORTRAIT.id,
      'skipped',
      expect.objectContaining({ error: expect.stringMatching(/Portrait/) }),
    );
    expect(queue.setDriveStatus).toHaveBeenCalledWith(
      'drive-1',
      'partial',
      expect.stringContaining('portrait'),
    );
  });

  it('reuses a stored file handle without re-uploading the image', async () => {
    queue.getPendingMapillaryCaptures.mockResolvedValue([
      { ...LANDSCAPE, mapillaryFileHandle: 'existing-handle' },
    ]);
    mockUploadAsync.mockReset();
    mockUploadAsync.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ h: 'manifest-handle' }),
    });

    const result = await uploadDriveToMapillary(
      { ...SUMMARY, captures: [{ ...LANDSCAPE, mapillaryFileHandle: 'existing-handle' }] },
      AUTH,
      { wifiOnly: true },
    );

    expect(result.uploaded).toBe(1);
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    expect(mockUploadAsync.mock.calls[0][0]).toContain('.json');
  });

  it('does not upload when every capture is portrait', async () => {
    queue.getPendingMapillaryCaptures.mockResolvedValue([PORTRAIT]);

    const result = await uploadDriveToMapillary(
      { ...SUMMARY, captures: [PORTRAIT], allLandscape: false },
      AUTH,
      { wifiOnly: true },
    );

    expect(result).toEqual({ clusterId: null, uploaded: 0, failed: 0, skipped: 1 });
    expect(mockUploadAsync).not.toHaveBeenCalled();
    expect(queue.setDriveStatus).toHaveBeenCalledWith(
      'drive-1',
      'partial',
      expect.stringMatching(/landscape/),
    );
  });

  it('surfaces an expired token and keeps the drive for retry', async () => {
    mockUploadAsync.mockReset();
    mockUploadAsync.mockResolvedValueOnce({ status: 401, body: '{}' });

    await expect(uploadDriveToMapillary(SUMMARY, AUTH, { wifiOnly: true })).rejects.toBeInstanceOf(
      MapillaryAuthError,
    );
    expect(queue.setDriveStatus).toHaveBeenCalledWith(
      'drive-1',
      'partial',
      expect.stringContaining('authentication'),
    );
  });

  it('refuses a cellular upload when Wi-Fi-only is on', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: true, type: 'cellular' });

    await expect(uploadDriveToMapillary(SUMMARY, AUTH, { wifiOnly: true })).rejects.toBeInstanceOf(
      MapillaryWifiOnlyError,
    );
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});
