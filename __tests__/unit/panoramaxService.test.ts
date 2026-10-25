const mockUploadAsync = jest.fn();
const mockNetInfoFetch = jest.fn();
const mockFetch = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })),
  dismissBrowser: jest.fn(async () => undefined),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: (...args: unknown[]) => mockNetInfoFetch(...args) },
}));

jest.mock('../../src/services/imagery/streetViewQueue', () => ({
  getOrCreateUploadBatch: jest.fn(),
  getPendingPanoramaxCaptures: jest.fn(),
  setCapturePanoramaxStatus: jest.fn(async () => undefined),
  setDriveStatus: jest.fn(async () => undefined),
  updateUploadBatch: jest.fn(async () => undefined),
}));

import type { StreetViewCapture, StreetViewDriveSummary } from '../../src/models/streetViewCapture';
import {
  normalizePanoramaxInstanceUrl,
  PanoramaxAuthError,
  PanoramaxWifiOnlyError,
  uploadDriveToPanoramax,
} from '../../src/services/imagery/panoramaxService';
const queue = jest.requireMock('../../src/services/imagery/streetViewQueue') as {
  getOrCreateUploadBatch: jest.Mock;
  getPendingPanoramaxCaptures: jest.Mock;
  setCapturePanoramaxStatus: jest.Mock;
  setDriveStatus: jest.Mock;
  updateUploadBatch: jest.Mock;
};

const CAPTURE: StreetViewCapture = {
  id: '11111111-1111-4111-8111-111111111111',
  driveId: 'drive-1',
  localUri: 'file:///captures/111.jpg',
  lat: 40.7128,
  lng: -74.006,
  altitude: 10,
  heading: 90,
  speedMps: 12,
  capturedAt: Date.UTC(2026, 9, 23, 14, 0, 0),
  width: 1920,
  height: 1080,
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

const SUMMARY: StreetViewDriveSummary = {
  drive: {
    id: 'drive-1',
    startedAt: Date.UTC(2026, 9, 23, 13, 55, 0),
    endedAt: Date.UTC(2026, 9, 23, 14, 5, 0),
    status: 'pending',
    captureCount: 1,
    bytes: 300_000,
    error: null,
    createdAt: Date.UTC(2026, 9, 23, 13, 55, 0),
  },
  captures: [CAPTURE],
  totalBytes: 300_000,
  allLandscape: true,
};

const AUTH = {
  instanceUrl: 'https://panoramax.example',
  jwt: 'jwt-token',
  tokenId: 'token-id',
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
    target: 'panoramax',
    remoteBatchId: null,
    status: 'pending',
    total: 0,
    uploaded: 0,
    failed: 0,
    error: null,
    createdAt: 0,
    updatedAt: 0,
  });
  queue.getPendingPanoramaxCaptures.mockResolvedValue([CAPTURE]);
  mockUploadAsync.mockResolvedValue({ status: 202, body: '{}', headers: {}, mimeType: null });
});

describe('normalizePanoramaxInstanceUrl', () => {
  it('requires HTTPS and removes trailing slashes', () => {
    expect(normalizePanoramaxInstanceUrl('https://panoramax.example/')).toBe(
      'https://panoramax.example',
    );
    expect(() => normalizePanoramaxInstanceUrl('http://panoramax.example')).toThrow(/HTTPS/);
  });
});

describe('uploadDriveToPanoramax', () => {
  it('creates an upload set, sends overrides and completes', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { id: 'set-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { ready: true }));

    const result = await uploadDriveToPanoramax(SUMMARY, AUTH, { wifiOnly: true });

    expect(result).toEqual({ uploadSetId: 'set-1', uploaded: 1, failed: 0 });
    expect(queue.getOrCreateUploadBatch).toHaveBeenCalledWith('drive-1', 'panoramax');
    expect(queue.updateUploadBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ remoteBatchId: 'set-1', status: 'uploading' }),
    );

    const uploadArgs = mockUploadAsync.mock.calls[0];
    expect(uploadArgs[0]).toBe('https://panoramax.example/api/upload_sets/set-1/files');
    expect(uploadArgs[1]).toBe(CAPTURE.localUri);
    expect(uploadArgs[2]).toEqual(
      expect.objectContaining({
        fieldName: 'file',
        parameters: expect.objectContaining({
          picture_id: CAPTURE.id,
          isBlurred: 'false',
          override_latitude: String(CAPTURE.lat),
          override_longitude: String(CAPTURE.lng),
        }),
      }),
    );
    expect(queue.setDriveStatus).toHaveBeenCalledWith('drive-1', 'complete', null);
  });

  it('treats a duplicate picture id as already uploaded', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { id: 'set-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { ready: true }));
    mockUploadAsync.mockResolvedValue({ status: 409, body: '{}', headers: {}, mimeType: null });

    const result = await uploadDriveToPanoramax(SUMMARY, AUTH, { wifiOnly: true });
    expect(result).toEqual({ uploadSetId: 'set-1', uploaded: 1, failed: 0 });
  });

  it('surfaces an authentication failure and keeps the drive for retry', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: 'set-1' }));
    mockUploadAsync.mockResolvedValue({ status: 401, body: '{}', headers: {}, mimeType: null });

    await expect(uploadDriveToPanoramax(SUMMARY, AUTH, { wifiOnly: true })).rejects.toBeInstanceOf(
      PanoramaxAuthError,
    );
    expect(queue.setDriveStatus).toHaveBeenCalledWith(
      'drive-1',
      'partial',
      expect.stringContaining('authentication'),
    );
  });

  it('refuses a cellular upload when Wi-Fi-only is on', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: true, type: 'cellular' });

    await expect(uploadDriveToPanoramax(SUMMARY, AUTH, { wifiOnly: true })).rejects.toBeInstanceOf(
      PanoramaxWifiOnlyError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
