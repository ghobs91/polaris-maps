const mockUploadAsync = jest.fn();
const mockWriteAsStringAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockNetInfoFetch = jest.fn();
const mockFetch = jest.fn();
const mockDeleteItem = jest.fn(async () => undefined);

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

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
  deleteItemAsync: (...args: unknown[]) => mockDeleteItem(...args),
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
import { useSettingsStore } from '../../src/stores/settingsStore';
import {
  MapillaryAuthError,
  MapillaryWifiOnlyError,
  segmentCaptures,
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
    stream: 'wide',
    pairId: null,
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
  useSettingsStore.getState().setStreetView({ mapillaryUsername: 'tester' });
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
      clusterIds: ['cluster-1'],
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

    expect(result).toEqual({
      clusterId: null,
      clusterIds: [],
      uploaded: 0,
      failed: 0,
      skipped: 1,
    });
    expect(mockUploadAsync).not.toHaveBeenCalled();
    expect(queue.setDriveStatus).toHaveBeenCalledWith(
      'drive-1',
      'partial',
      expect.stringMatching(/landscape/),
    );
  });

  it('refreshes an expired token once and retries the upload', async () => {
    mockUploadAsync.mockReset();
    mockUploadAsync
      .mockResolvedValueOnce({ status: 401, body: '{}' })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'image-handle' }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'manifest-handle' }) });
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'fresh-token', expires_in: 9000 }))
      .mockResolvedValueOnce(jsonResponse(200, { cluster_id: 'cluster-1' }));

    const result = await uploadDriveToMapillary(SUMMARY, AUTH, { wifiOnly: true });

    expect(result.uploaded).toBe(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://graph.mapillary.com/token');
    // The retry uses the refreshed token rather than the rejected one.
    expect(mockUploadAsync.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'OAuth fresh-token' }),
      }),
    );
  });

  it('disconnects the account when the token cannot be refreshed', async () => {
    mockUploadAsync.mockReset();
    mockUploadAsync.mockResolvedValueOnce({ status: 401, body: '{}' });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonResponse(401, { error: 'invalid_token' }));

    await expect(uploadDriveToMapillary(SUMMARY, AUTH, { wifiOnly: true })).rejects.toBeInstanceOf(
      MapillaryAuthError,
    );
    expect(mockDeleteItem).toHaveBeenCalled();
    expect(useSettingsStore.getState().streetView.mapillaryUsername).toBeNull();
    expect(queue.setDriveStatus).toHaveBeenCalledWith(
      'drive-1',
      'partial',
      expect.stringContaining('expired'),
    );
  });

  it('retries a transient upload failure before giving up on the file', async () => {
    mockUploadAsync.mockReset();
    mockUploadAsync
      .mockResolvedValueOnce({ status: 503, body: '{}' })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'image-handle' }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'manifest-handle' }) });

    const result = await uploadDriveToMapillary(SUMMARY, AUTH, { wifiOnly: true });

    expect(result.uploaded).toBe(1);
    expect(mockUploadAsync).toHaveBeenCalledTimes(3);
  });

  it('submits one cluster per drive segment across a long stop', async () => {
    const first = capture('first', 1920, 1080);
    const second = {
      ...capture('second', 1920, 1080),
      capturedAt: first.capturedAt + 30 * 60 * 1000,
    };
    queue.getPendingMapillaryCaptures.mockResolvedValue([first, second]);
    mockUploadAsync.mockReset();
    mockUploadAsync
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'handle-1' }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'manifest-1' }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'handle-2' }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: 'manifest-2' }) });
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { cluster_id: 'cluster-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { cluster_id: 'cluster-2' }));

    const result = await uploadDriveToMapillary(
      { ...SUMMARY, captures: [first, second], allLandscape: true },
      AUTH,
      { wifiOnly: true },
    );

    expect(result.clusterIds).toEqual(['cluster-1', 'cluster-2']);
    expect(result.clusterId).toBe('cluster-1');
    expect(result.uploaded).toBe(2);
    expect(queue.updateUploadBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ remoteBatchId: 'cluster-1,cluster-2' }),
    );
  });

  it('uploads the detail stream as separate clusters after the wide sequence', async () => {
    const wideOne = capture('wide-1', 1920, 1080);
    const wideTwo = { ...capture('wide-2', 1920, 1080), capturedAt: wideOne.capturedAt + 20_000 };
    const detailOne = {
      ...capture('detail-1', 1920, 1080),
      stream: 'detail' as const,
      pairId: wideOne.id,
      capturedAt: wideOne.capturedAt + 400,
    };
    const detailTwo = {
      ...capture('detail-2', 1920, 1080),
      stream: 'detail' as const,
      pairId: wideTwo.id,
      capturedAt: wideTwo.capturedAt + 400,
    };
    // Interleaved in capture order, the way the queue returns them.
    queue.getPendingMapillaryCaptures.mockResolvedValue([wideOne, detailOne, wideTwo, detailTwo]);
    mockUploadAsync.mockReset();
    for (const handle of [
      'wide-handle-1',
      'wide-handle-2',
      'wide-manifest',
      'detail-handle-1',
      'detail-handle-2',
      'detail-manifest',
    ]) {
      mockUploadAsync.mockResolvedValueOnce({ status: 200, body: JSON.stringify({ h: handle }) });
    }
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { cluster_id: 'cluster-wide' }))
      .mockResolvedValueOnce(jsonResponse(200, { cluster_id: 'cluster-detail' }));

    const result = await uploadDriveToMapillary(
      { ...SUMMARY, captures: [wideOne, detailOne, wideTwo, detailTwo], allLandscape: true },
      AUTH,
      { wifiOnly: true },
    );

    expect(result.clusterIds).toEqual(['cluster-wide', 'cluster-detail']);
    expect(result.uploaded).toBe(4);
    // No cluster mixes the two perspectives.
    expect(mockWriteAsStringAsync.mock.calls[0][1]).toBe(
      JSON.stringify({
        version: '1',
        upload_type: 'images',
        image_handles: ['wide-handle-1', 'wide-handle-2'],
      }),
    );
    expect(mockWriteAsStringAsync.mock.calls[1][1]).toBe(
      JSON.stringify({
        version: '1',
        upload_type: 'images',
        image_handles: ['detail-handle-1', 'detail-handle-2'],
      }),
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

describe('segmentCaptures', () => {
  it('starts a new segment after a long stop and keeps capture order', () => {
    const first = capture('a', 1920, 1080);
    const second = { ...capture('b', 1920, 1080), capturedAt: first.capturedAt + 60_000 };
    const afterBreak = {
      ...capture('c', 1920, 1080),
      capturedAt: second.capturedAt + 11 * 60 * 1000,
    };

    const segments = segmentCaptures([afterBreak, first, second]);

    expect(segments.map((segment) => segment.map((entry) => entry.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('caps a single segment at 1,000 images', () => {
    const captures = Array.from({ length: 1_001 }, (_, index) => ({
      ...capture(`c${index}`, 1920, 1080),
      capturedAt: Date.UTC(2026, 9, 23, 14, 0, 0) + index * 1_000,
    }));

    const segments = segmentCaptures(captures);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(1_000);
    expect(segments[1]).toHaveLength(1);
  });
});
