import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import NetInfo from '@react-native-community/netinfo';
import {
  MAPILLARY_GRAPH_URL,
  MAPILLARY_UPLOAD_CLIENT_ID,
  MAPILLARY_UPLOAD_CLIENT_SECRET,
  MAPILLARY_UPLOAD_REDIRECT_URI,
  MAPILLARY_UPLOAD_SCOPE,
  MAPILLARY_UPLOAD_URL,
  isMapillaryUploadConfigured,
} from '../../constants/config';
import type { StreetViewCapture, StreetViewDriveSummary } from '../../models/streetViewCapture';
import {
  getOrCreateUploadBatch,
  getPendingMapillaryCaptures,
  setCaptureMapillaryStatus,
  setDriveStatus,
  updateUploadBatch,
} from './streetViewQueue';

const AUTH_KEY = 'streetview.mapillary.auth';
const FETCH_TIMEOUT_MS = 20_000;

export interface MapillaryAuth {
  accessToken: string;
  /** Epoch ms after which the token should be refreshed. */
  expiresAt: number;
  userId?: string;
  username?: string;
}

export interface MapillaryUser {
  id: string;
  username?: string;
}

export class MapillaryAuthError extends Error {
  constructor(message = 'Mapillary authentication expired') {
    super(message);
    this.name = 'MapillaryAuthError';
  }
}

export class MapillaryNetworkError extends Error {
  constructor(message = 'Mapillary upload needs a network connection') {
    super(message);
    this.name = 'MapillaryNetworkError';
  }
}

export class MapillaryWifiOnlyError extends Error {
  constructor(message = 'Mapillary upload is set to Wi-Fi only') {
    super(message);
    this.name = 'MapillaryWifiOnlyError';
  }
}

async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new MapillaryNetworkError(
      error instanceof Error ? error.message : 'Network request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected Mapillary response (${response.status})`);
  }
}

function tokenAuthHeader(token: string): Record<string, string> {
  // Mapillary's API accepts `OAuth <user token>` for graph and upload calls.
  return { Authorization: `OAuth ${token}` };
}

export async function saveMapillaryAuth(auth: MapillaryAuth): Promise<void> {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth));
}

export async function loadMapillaryAuth(): Promise<MapillaryAuth | null> {
  const raw = await SecureStore.getItemAsync(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MapillaryAuth;
  } catch {
    return null;
  }
}

export async function clearMapillaryAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_KEY).catch(() => {});
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

async function exchangeCode(code: string): Promise<MapillaryAuth> {
  const response = await request(`${MAPILLARY_GRAPH_URL}/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // The embedded client token/secret is the documented OAuth client
      // credential for the token exchange.
      Authorization: `OAuth ${MAPILLARY_UPLOAD_CLIENT_SECRET}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: MAPILLARY_UPLOAD_CLIENT_ID,
      redirect_uri: MAPILLARY_UPLOAD_REDIRECT_URI,
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new MapillaryAuthError('Mapillary rejected the authorization code');
  }
  if (!response.ok) {
    throw new Error(`Mapillary token exchange failed (${response.status})`);
  }
  const payload = await readJson<TokenResponse>(response);
  if (!payload.access_token) throw new Error('Mapillary did not return an access token');
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(0, (payload.expires_in ?? 3600) - 60) * 1000,
  };
}

async function refreshAuth(auth: MapillaryAuth): Promise<MapillaryAuth> {
  const response = await request(`${MAPILLARY_GRAPH_URL}/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `OAuth ${MAPILLARY_UPLOAD_CLIENT_SECRET}`,
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: auth.accessToken,
      client_id: MAPILLARY_UPLOAD_CLIENT_ID,
    }),
  });
  if (response.status === 401 || response.status === 403) {
    await clearMapillaryAuth();
    throw new MapillaryAuthError();
  }
  if (!response.ok) {
    throw new Error(`Mapillary token refresh failed (${response.status})`);
  }
  const payload = await readJson<TokenResponse>(response);
  if (!payload.access_token) throw new Error('Mapillary did not return an access token');
  return {
    ...auth,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(0, (payload.expires_in ?? 3600) - 60) * 1000,
  };
}

export async function getValidMapillaryAuth(): Promise<MapillaryAuth> {
  const auth = await loadMapillaryAuth();
  if (!auth) throw new MapillaryAuthError('Connect Mapillary in Settings first');
  if (auth.expiresAt > Date.now()) return auth;
  const refreshed = await refreshAuth(auth);
  await saveMapillaryAuth(refreshed);
  return refreshed;
}

export async function getMapillaryMe(token: string): Promise<MapillaryUser> {
  const response = await request(`${MAPILLARY_GRAPH_URL}/me?fields=id,username`, {
    headers: { Accept: 'application/json', ...tokenAuthHeader(token) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new MapillaryAuthError();
  }
  if (!response.ok) {
    throw new Error(`Mapillary account check failed (${response.status})`);
  }
  return readJson<MapillaryUser>(response);
}

function parseRedirect(url: string): { code?: string; state?: string; error?: string } {
  try {
    const parsed = new URL(url);
    return {
      code: parsed.searchParams.get('code') ?? undefined,
      state: parsed.searchParams.get('state') ?? undefined,
      error: parsed.searchParams.get('error') ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Embedded-secret OAuth flow. The client id/secret are build-time values from a
 * dedicated upload-scoped Mapillary app registration.
 */
export async function connectMapillary(): Promise<MapillaryUser> {
  if (!isMapillaryUploadConfigured()) {
    throw new Error(
      'Mapillary upload is not configured in this build (EXPO_PUBLIC_MAPILLARY_CLIENT_ID / EXPO_PUBLIC_MAPILLARY_CLIENT_SECRET).',
    );
  }

  const state = Crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: MAPILLARY_UPLOAD_CLIENT_ID,
    redirect_uri: MAPILLARY_UPLOAD_REDIRECT_URI,
    response_type: 'code',
    scope: MAPILLARY_UPLOAD_SCOPE,
    state,
  });
  const result = await WebBrowser.openAuthSessionAsync(
    `https://www.mapillary.com/connect?${params.toString()}`,
    MAPILLARY_UPLOAD_REDIRECT_URI,
  );
  if (result.type !== 'success' || !result.url) {
    throw new Error('Mapillary sign-in was cancelled');
  }

  const redirect = parseRedirect(result.url);
  if (redirect.error) throw new Error(`Mapillary sign-in failed: ${redirect.error}`);
  if (!redirect.code) throw new Error('Mapillary sign-in did not return a code');
  if (redirect.state && redirect.state !== state) {
    throw new Error('Mapillary sign-in state did not match');
  }

  const auth = await exchangeCode(redirect.code);
  const user = await getMapillaryMe(auth.accessToken);
  await saveMapillaryAuth({ ...auth, userId: user.id, username: user.username });
  return user;
}

export async function disconnectMapillary(): Promise<void> {
  await clearMapillaryAuth();
}

interface UploadHandleResponse {
  h?: string;
}

async function uploadBinary(
  auth: MapillaryAuth,
  fileUri: string,
  sessionKey: string,
  contentType: string,
): Promise<string> {
  const response = await FileSystem.uploadAsync(`${MAPILLARY_UPLOAD_URL}/${sessionKey}`, fileUri, {
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    httpMethod: 'POST',
    mimeType: contentType,
    sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    headers: {
      ...tokenAuthHeader(auth.accessToken),
      Offset: '0',
      'X-Entity-Name': sessionKey,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new MapillaryAuthError();
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Mapillary upload failed (${response.status})`);
  }
  const payload = JSON.parse(response.body || '{}') as UploadHandleResponse;
  if (!payload.h) throw new Error('Mapillary did not return a file handle');
  return payload.h;
}

async function uploadImage(auth: MapillaryAuth, capture: StreetViewCapture): Promise<string> {
  const sessionKey = `${capture.id}.jpg`;
  return uploadBinary(auth, capture.localUri, sessionKey, 'image/jpeg');
}

async function uploadManifest(auth: MapillaryAuth, imageHandles: string[]): Promise<string> {
  const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!cacheDir) throw new Error('No cache directory for the Mapillary manifest');
  const manifestPath = `${cacheDir}mapillary-manifest-${Crypto.randomUUID()}.json`;
  const manifest = {
    version: '1',
    upload_type: 'images',
    image_handles: imageHandles,
  };
  await FileSystem.writeAsStringAsync(manifestPath, JSON.stringify(manifest));
  try {
    return await uploadBinary(
      auth,
      manifestPath,
      `${Crypto.randomUUID()}.json`,
      'application/json',
    );
  } finally {
    await FileSystem.deleteAsync(manifestPath, { idempotent: true }).catch(() => {});
  }
}

async function finishUpload(auth: MapillaryAuth, manifestHandle: string): Promise<string> {
  const response = await request(
    `${MAPILLARY_GRAPH_URL}/finish_upload`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...tokenAuthHeader(auth.accessToken),
      },
      body: JSON.stringify({
        file_handle: manifestHandle,
        file_type: 'mly_bundle_manifest',
      }),
    },
    60_000,
  );
  if (response.status === 401 || response.status === 403) {
    throw new MapillaryAuthError();
  }
  if (!response.ok) {
    throw new Error(`Mapillary could not finish the upload (${response.status})`);
  }
  const payload = await readJson<{ cluster_id?: string }>(response);
  if (!payload.cluster_id) throw new Error('Mapillary did not return a cluster id');
  return payload.cluster_id;
}

export interface MapillaryUploadProgress {
  uploaded: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface MapillaryUploadResult {
  clusterId: string | null;
  uploaded: number;
  failed: number;
  skipped: number;
}

/**
 * Upload landscape captures from one drive. Portrait captures are skipped
 * because Mapillary rejects them; they remain in the local queue (and can still
 * go to Panoramax).
 */
export async function uploadDriveToMapillary(
  summary: StreetViewDriveSummary,
  auth: MapillaryAuth,
  options: {
    wifiOnly: boolean;
    onProgress?: (progress: MapillaryUploadProgress) => void;
  },
): Promise<MapillaryUploadResult> {
  const net = await NetInfo.fetch();
  if (!net.isConnected) throw new MapillaryNetworkError();
  if (options.wifiOnly && net.type !== 'wifi' && net.type !== 'ethernet') {
    throw new MapillaryWifiOnlyError();
  }

  const batch = await getOrCreateUploadBatch(summary.drive.id, 'mapillary');
  const pending = await getPendingMapillaryCaptures(summary.drive.id);
  const landscape = pending.filter((capture) => capture.width >= capture.height);
  const portrait = pending.filter((capture) => capture.width < capture.height);

  for (const capture of portrait) {
    await setCaptureMapillaryStatus(capture.id, 'skipped', {
      error: 'Portrait images are not supported by Mapillary',
    });
  }

  if (landscape.length === 0) {
    const message =
      portrait.length > 0
        ? 'Mapillary needs landscape photos; this drive has none.'
        : 'No photos are waiting for Mapillary.';
    await updateUploadBatch(batch.id, {
      status: portrait.length > 0 ? 'partial' : 'complete',
      total: pending.length,
      uploaded: 0,
      failed: 0,
      error: portrait.length > 0 ? message : null,
    });
    await setDriveStatus(
      summary.drive.id,
      portrait.length > 0 ? 'partial' : 'complete',
      portrait.length > 0 ? message : null,
    );
    return { clusterId: null, uploaded: 0, failed: 0, skipped: portrait.length };
  }

  const handles: string[] = [];
  const successfulIds: string[] = [];
  let failed = 0;

  for (const capture of landscape) {
    let handle = capture.mapillaryFileHandle;
    try {
      if (!handle) {
        await setCaptureMapillaryStatus(capture.id, 'uploading');
        handle = await uploadImage(auth, capture);
        await setCaptureMapillaryStatus(capture.id, 'uploading', { fileHandle: handle });
      }
      handles.push(handle);
      successfulIds.push(capture.id);
    } catch (error) {
      if (error instanceof MapillaryAuthError) {
        await updateUploadBatch(batch.id, { status: 'failed', error: error.message });
        await setDriveStatus(summary.drive.id, 'partial', error.message);
        throw error;
      }
      failed += 1;
      await setCaptureMapillaryStatus(capture.id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    options.onProgress?.({
      uploaded: successfulIds.length,
      failed,
      skipped: portrait.length,
      total: landscape.length,
    });
    await updateUploadBatch(batch.id, {
      status: 'uploading',
      total: landscape.length,
      uploaded: successfulIds.length,
      failed,
    });
  }

  if (handles.length === 0) {
    const message = 'No Mapillary images could be uploaded';
    await updateUploadBatch(batch.id, { status: 'failed', error: message });
    await setDriveStatus(summary.drive.id, 'partial', message);
    return { clusterId: null, uploaded: 0, failed, skipped: portrait.length };
  }

  let clusterId: string;
  try {
    const manifestHandle = await uploadManifest(auth, handles);
    clusterId = await finishUpload(auth, manifestHandle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateUploadBatch(batch.id, {
      status: 'failed',
      uploaded: successfulIds.length,
      failed,
      total: landscape.length,
      error: message,
    });
    await setDriveStatus(summary.drive.id, 'partial', message);
    throw error;
  }
  // Store the cluster before flipping per-file statuses so a crash after
  // finish does not lose the only remote identifier.
  await updateUploadBatch(batch.id, {
    remoteBatchId: clusterId,
    uploaded: successfulIds.length,
    failed,
    total: landscape.length,
  });

  for (const id of successfulIds) {
    await setCaptureMapillaryStatus(id, 'uploaded');
  }

  const skipped = portrait.length;
  const partial = failed > 0 || skipped > 0;
  const error = partial
    ? [
        failed > 0 ? `${failed} photo${failed === 1 ? '' : 's'} failed` : null,
        skipped > 0 ? `${skipped} portrait photo${skipped === 1 ? '' : 's'} skipped` : null,
      ]
        .filter(Boolean)
        .join('; ')
    : null;
  await updateUploadBatch(batch.id, {
    status: partial ? 'partial' : 'complete',
    remoteBatchId: clusterId,
    uploaded: successfulIds.length,
    failed,
    total: landscape.length,
    error,
  });
  await setDriveStatus(summary.drive.id, partial ? 'partial' : 'complete', error);

  return { clusterId, uploaded: successfulIds.length, failed, skipped };
}
