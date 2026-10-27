import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import NetInfo from '@react-native-community/netinfo';
import {
  MAPILLARY_GRAPH_URL,
  MAPILLARY_APP_CALLBACK,
  MAPILLARY_UPLOAD_CLIENT_ID,
  MAPILLARY_UPLOAD_CLIENT_SECRET,
  MAPILLARY_UPLOAD_REDIRECT_URI,
  MAPILLARY_UPLOAD_SCOPE,
  MAPILLARY_UPLOAD_URL,
  isMapillaryUploadConfigured,
} from '../../constants/config';
import type { StreetViewCapture, StreetViewDriveSummary } from '../../models/streetViewCapture';
import { useSettingsStore } from '../../stores/settingsStore';
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

/** A 429/5xx/offline failure that is worth retrying with backoff. */
class MapillaryTransientError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'MapillaryTransientError';
  }
}

/** One cluster per ~1,000 images keeps manifests small enough to manage. */
const MAX_IMAGES_PER_CLUSTER = 1000;
/** A long stop (parking, a break) starts a new sequence on Mapillary. */
const MAX_CLUSTER_GAP_MS = 10 * 60 * 1000;
const TRANSIENT_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 700;
const MAX_RETRY_DELAY_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(Math.max(0, at - Date.now()), MAX_RETRY_DELAY_MS) : null;
}

function retryAfterFromHeaders(headers?: Record<string, string> | null): number | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'retry-after');
  return key ? parseRetryAfter(headers[key]) : null;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Retries transient (429/5xx) failures with exponential backoff. */
async function withTransientRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof MapillaryTransientError) || attempt >= TRANSIENT_ATTEMPTS) throw error;
      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await delay(Math.min(error.retryAfterMs ?? backoff, MAX_RETRY_DELAY_MS));
    }
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

/**
 * The token is unusable: drop the credential and the account label so the
 * end-of-drive sheet and Settings both show "not connected" instead of a
 * connection that silently fails on every upload.
 */
async function markDisconnected(): Promise<void> {
  await clearMapillaryAuth().catch(() => {});
  useSettingsStore.getState().setStreetView({ mapillaryUsername: null });
}

/**
 * Refresh the user token, or mark the account disconnected. Network failures
 * keep the credential and the queue so a later retry can still succeed.
 */
async function refreshAuthOrDisconnect(auth: MapillaryAuth): Promise<MapillaryAuth> {
  let refreshed: MapillaryAuth;
  try {
    refreshed = await refreshAuth(auth);
  } catch (error) {
    if (error instanceof MapillaryAuthError) {
      await markDisconnected();
      throw new MapillaryAuthError('Mapillary sign-in expired — reconnect in Settings');
    }
    throw error;
  }
  await saveMapillaryAuth(refreshed);
  return refreshed;
}

/**
 * Runs a call with the current token, and retries it once after a refresh when
 * Mapillary rejects the token. `authRef` carries the new token forward so later
 * calls in the same drive do not each pay for a refresh.
 */
async function withAuthRetry<T>(
  authRef: { current: MapillaryAuth },
  run: (auth: MapillaryAuth) => Promise<T>,
): Promise<T> {
  try {
    return await run(authRef.current);
  } catch (error) {
    if (!(error instanceof MapillaryAuthError)) throw error;
    authRef.current = await refreshAuthOrDisconnect(authRef.current);
    return run(authRef.current);
  }
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
  // The browser navigates to the https redirect first; that page forwards to
  // the app scheme, which is what closes the auth session.
  const result = await WebBrowser.openAuthSessionAsync(
    `https://www.mapillary.com/connect?${params.toString()}`,
    MAPILLARY_APP_CALLBACK,
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
  const response = await withTransientRetry(async () => {
    const result = await FileSystem.uploadAsync(`${MAPILLARY_UPLOAD_URL}/${sessionKey}`, fileUri, {
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
    if (isTransientStatus(result.status)) {
      throw new MapillaryTransientError(
        `Mapillary upload failed (${result.status})`,
        retryAfterFromHeaders(result.headers),
      );
    }
    return result;
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
  const response = await withTransientRetry(async () => {
    const result = await request(
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
    if (isTransientStatus(result.status)) {
      throw new MapillaryTransientError(
        `Mapillary could not finish the upload (${result.status})`,
        parseRetryAfter(result.headers.get('retry-after')),
      );
    }
    return result;
  });
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
  /** First cluster id, kept for the common single-segment drive. */
  clusterId: string | null;
  /** One cluster id per drive segment Mapillary accepted. */
  clusterIds: string[];
  uploaded: number;
  failed: number;
  skipped: number;
}

/**
 * Splits a drive into Mapillary "sequence"-sized segments: a new cluster after
 * a long stop (a break, parking) or once a manifest grows past
 * `MAX_IMAGES_PER_CLUSTER`. One giant manifest for a multi-hour drive is the
 * case that tends to fail server-side, so bound it here.
 */
export function segmentCaptures(captures: StreetViewCapture[]): StreetViewCapture[][] {
  const sorted = [...captures].sort((a, b) => a.capturedAt - b.capturedAt);
  const segments: StreetViewCapture[][] = [];
  let current: StreetViewCapture[] = [];
  let previousAt: number | null = null;

  for (const capture of sorted) {
    const gap = previousAt == null ? 0 : capture.capturedAt - previousAt;
    const shouldSplit =
      current.length > 0 && (gap > MAX_CLUSTER_GAP_MS || current.length >= MAX_IMAGES_PER_CLUSTER);
    if (shouldSplit) {
      segments.push(current);
      current = [];
    }
    current.push(capture);
    previousAt = capture.capturedAt;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Upload landscape captures from one drive. Portrait captures are skipped
 * because Mapillary rejects them; they remain in the local queue until the
 * drive is deleted.
 *
 * `wide` captures form the sequence; `detail` captures are uploaded after
 * them, as separate clusters.
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
    return { clusterId: null, clusterIds: [], uploaded: 0, failed: 0, skipped: portrait.length };
  }

  // The token can be rotated mid-drive; every call reads the current one.
  const authRef = { current: auth };
  // Wide frames are the canonical sequence that Mapillary aligns to the road;
  // detail frames follow as their own clusters. Segmenting each stream on its
  // own and concatenating the lists (never merging them) guarantees a
  // telephoto crop never lands between two context frames of the sequence.
  const wideCaptures = landscape.filter((capture) => capture.stream !== 'detail');
  const detailCaptures = landscape.filter((capture) => capture.stream === 'detail');
  const segments = [...segmentCaptures(wideCaptures), ...segmentCaptures(detailCaptures)];
  const clusterIds: string[] = [];
  const uploadedIds: string[] = [];
  let failed = 0;
  let segmentFailures = 0;

  const reportProgress = async () => {
    options.onProgress?.({
      uploaded: uploadedIds.length,
      failed,
      skipped: portrait.length,
      total: landscape.length,
    });
    await updateUploadBatch(batch.id, {
      status: 'uploading',
      total: landscape.length,
      uploaded: uploadedIds.length,
      failed,
    });
  };

  try {
    for (const segment of segments) {
      const handles: string[] = [];
      const segmentIds: string[] = [];

      for (const capture of segment) {
        try {
          let handle = capture.mapillaryFileHandle;
          if (!handle) {
            await setCaptureMapillaryStatus(capture.id, 'uploading');
            handle = await withAuthRetry(authRef, (current) =>
              withTransientRetry(() => uploadImage(current, capture)),
            );
            await setCaptureMapillaryStatus(capture.id, 'uploading', { fileHandle: handle });
          }
          handles.push(handle);
          segmentIds.push(capture.id);
        } catch (error) {
          // A dead token or a lost connection aborts the drive; the queue and
          // any stored handles survive so the next attempt resumes.
          if (error instanceof MapillaryAuthError || error instanceof MapillaryNetworkError) {
            throw error;
          }
          failed += 1;
          await setCaptureMapillaryStatus(capture.id, 'failed', { error: errorMessage(error) });
        }
        await reportProgress();
      }

      if (handles.length === 0) {
        segmentFailures += 1;
        continue;
      }

      try {
        const clusterId = await withAuthRetry(authRef, async (current) => {
          const manifestHandle = await withTransientRetry(() => uploadManifest(current, handles));
          return withTransientRetry(() => finishUpload(current, manifestHandle));
        });
        clusterIds.push(clusterId);
        for (const id of segmentIds) {
          uploadedIds.push(id);
          await setCaptureMapillaryStatus(id, 'uploaded');
        }
        // Persist clusters as they land so a crash mid-drive keeps the ids.
        await updateUploadBatch(batch.id, {
          remoteBatchId: clusterIds.join(','),
          uploaded: uploadedIds.length,
          failed,
          total: landscape.length,
        });
      } catch (error) {
        if (error instanceof MapillaryAuthError || error instanceof MapillaryNetworkError) {
          throw error;
        }
        // The image handles are stored, so a retry re-submits this manifest
        // instead of re-uploading every photo.
        segmentFailures += 1;
        await updateUploadBatch(batch.id, { status: 'uploading', error: errorMessage(error) });
      }
      await reportProgress();
    }
  } catch (error) {
    const message = errorMessage(error);
    await updateUploadBatch(batch.id, {
      status: 'failed',
      uploaded: uploadedIds.length,
      failed,
      total: landscape.length,
      error: message,
    });
    await setDriveStatus(summary.drive.id, 'partial', message);
    throw error;
  }

  if (clusterIds.length === 0) {
    const message = 'No Mapillary images could be uploaded';
    await updateUploadBatch(batch.id, {
      status: 'failed',
      uploaded: 0,
      failed,
      total: landscape.length,
      error: message,
    });
    await setDriveStatus(summary.drive.id, 'partial', message);
    return { clusterId: null, clusterIds: [], uploaded: 0, failed, skipped: portrait.length };
  }

  // Every selected target accepted the files; drop the originals so a
  // long drive does not keep several GB in the document directory.
  const skipped = portrait.length;
  const partial = failed > 0 || skipped > 0 || segmentFailures > 0;
  const error = partial
    ? [
        failed > 0 ? `${failed} photo${failed === 1 ? '' : 's'} failed` : null,
        skipped > 0 ? `${skipped} portrait photo${skipped === 1 ? '' : 's'} skipped` : null,
        segmentFailures > 0
          ? `${segmentFailures} upload batch${segmentFailures === 1 ? '' : 'es'} could not finish`
          : null,
      ]
        .filter(Boolean)
        .join('; ')
    : null;
  await updateUploadBatch(batch.id, {
    status: partial ? 'partial' : 'complete',
    remoteBatchId: clusterIds.join(','),
    uploaded: uploadedIds.length,
    failed,
    total: landscape.length,
    error,
  });
  await setDriveStatus(summary.drive.id, partial ? 'partial' : 'complete', error);

  return {
    clusterId: clusterIds[0] ?? null,
    clusterIds,
    uploaded: uploadedIds.length,
    failed,
    skipped,
  };
}
