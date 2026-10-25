import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import NetInfo from '@react-native-community/netinfo';
import type { StreetViewCapture, StreetViewDriveSummary } from '../../models/streetViewCapture';
import {
  getOrCreateUploadBatch,
  getPendingPanoramaxCaptures,
  setCapturePanoramaxStatus,
  setDriveStatus,
  updateUploadBatch,
} from './streetViewQueue';

const CATALOG_URL = 'https://api.panoramax.xyz/api/instances';
const FETCH_TIMEOUT_MS = 20_000;

export interface PanoramaxInstance {
  name: string;
  url: string;
}

export interface PanoramaxUser {
  id: string;
  name: string;
}

export interface PanoramaxAuth {
  instanceUrl: string;
  jwt: string;
  tokenId: string | null;
}

export class PanoramaxAuthError extends Error {
  constructor(message = 'Panoramax authentication expired') {
    super(message);
    this.name = 'PanoramaxAuthError';
  }
}

export class PanoramaxNetworkError extends Error {
  constructor(message = 'Street imagery upload needs a network connection') {
    super(message);
    this.name = 'PanoramaxNetworkError';
  }
}

export class PanoramaxWifiOnlyError extends Error {
  constructor(message = 'Street imagery upload is set to Wi-Fi only') {
    super(message);
    this.name = 'PanoramaxWifiOnlyError';
  }
}

export function normalizePanoramaxInstanceUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error('Panoramax instance must use HTTPS');
  }
  return trimmed;
}

function apiUrl(instanceUrl: string, path: string): string {
  return `${normalizePanoramaxInstanceUrl(instanceUrl)}/api${path}`;
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
    throw new PanoramaxNetworkError(
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
    throw new Error(`Unexpected Panoramax response (${response.status})`);
  }
}

let instanceCache: { at: number; items: PanoramaxInstance[] } | null = null;

/** Searchable instance list from the federated Panoramax catalog. */
export async function fetchPanoramaxInstances(force = false): Promise<PanoramaxInstance[]> {
  if (!force && instanceCache && Date.now() - instanceCache.at < 60 * 60 * 1000) {
    return instanceCache.items;
  }

  const response = await request(CATALOG_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Could not load Panoramax instances (${response.status})`);
  }
  const payload = await readJson<{
    instances?: Array<{ name?: string; url?: string }>;
  }>(response);

  const seen = new Set<string>();
  const items: PanoramaxInstance[] = [];
  for (const entry of payload.instances ?? []) {
    if (!entry.url || !/^https:\/\//i.test(entry.url)) continue;
    let url: string;
    try {
      url = normalizePanoramaxInstanceUrl(entry.url);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ name: entry.name?.trim() || url.replace(/^https:\/\//, ''), url });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  instanceCache = { at: Date.now(), items };
  return items;
}

function secureKey(instanceUrl: string): string {
  return `streetview.panoramax.${normalizePanoramaxInstanceUrl(instanceUrl).replace(
    /[^A-Za-z0-9._-]/g,
    '_',
  )}`;
}

export async function savePanoramaxAuth(auth: PanoramaxAuth): Promise<void> {
  const key = secureKey(auth.instanceUrl);
  await SecureStore.setItemAsync(`${key}.jwt`, auth.jwt);
  await SecureStore.setItemAsync(`${key}.tokenId`, auth.tokenId ?? '');
}

export async function loadPanoramaxAuth(instanceUrl: string): Promise<PanoramaxAuth | null> {
  const key = secureKey(instanceUrl);
  const jwt = await SecureStore.getItemAsync(`${key}.jwt`);
  if (!jwt) return null;
  const tokenId = await SecureStore.getItemAsync(`${key}.tokenId`);
  return {
    instanceUrl: normalizePanoramaxInstanceUrl(instanceUrl),
    jwt,
    tokenId: tokenId || null,
  };
}

export async function clearPanoramaxAuth(instanceUrl: string): Promise<void> {
  const key = secureKey(instanceUrl);
  await SecureStore.deleteItemAsync(`${key}.jwt`).catch(() => {});
  await SecureStore.deleteItemAsync(`${key}.tokenId`).catch(() => {});
}

interface GeneratedToken {
  id?: string;
  jwt_token?: string;
  links?: Array<{ rel?: string; href?: string }>;
}

export async function generatePanoramaxToken(instanceUrl: string): Promise<GeneratedToken> {
  const response = await request(apiUrl(instanceUrl, '/auth/tokens/generate'), {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Could not start Panoramax sign-in (${response.status})`);
  }
  return readJson<GeneratedToken>(response);
}

export async function getPanoramaxMe(instanceUrl: string, jwt: string): Promise<PanoramaxUser> {
  const response = await request(apiUrl(instanceUrl, '/users/me'), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new PanoramaxAuthError();
  }
  if (!response.ok) {
    throw new Error(`Panoramax account check failed (${response.status})`);
  }
  return readJson<PanoramaxUser>(response);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token-claim flow: generate an unclaimed token, open the instance's claim URL
 * in the browser, then poll `/users/me` until the account is attached.
 */
export async function connectPanoramax(
  instanceUrl: string,
): Promise<{ auth: PanoramaxAuth; user: PanoramaxUser }> {
  const instance = normalizePanoramaxInstanceUrl(instanceUrl);
  const generated = await generatePanoramaxToken(instance);
  const claimUrl = generated.links?.find((link) => link.rel === 'claim')?.href;
  if (!generated.jwt_token || !claimUrl) {
    throw new Error('Panoramax did not return a claimable token');
  }

  void WebBrowser.openBrowserAsync(claimUrl, { showTitle: true }).catch(() => {});

  const auth: PanoramaxAuth = {
    instanceUrl: instance,
    jwt: generated.jwt_token,
    tokenId: generated.id ?? null,
  };

  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const user = await getPanoramaxMe(instance, auth.jwt);
      await savePanoramaxAuth(auth);
      void WebBrowser.dismissBrowser().catch(() => {});
      return { auth, user };
    } catch (error) {
      if (!(error instanceof PanoramaxAuthError)) throw error;
    }
    await delay(2000);
  }

  throw new Error('Panoramax sign-in timed out. Try again from Settings.');
}

export async function disconnectPanoramax(instanceUrl: string): Promise<void> {
  const auth = await loadPanoramaxAuth(instanceUrl);
  if (auth?.tokenId) {
    await request(apiUrl(auth.instanceUrl, `/users/me/tokens/${auth.tokenId}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.jwt}` },
    }).catch(() => {});
  }
  await clearPanoramaxAuth(instanceUrl);
}

interface UploadSetResponse {
  id?: string;
  ready?: boolean;
  items_status?: unknown;
  associated_collections?: Array<{ id?: string; links?: Array<{ href?: string }> }>;
}

export async function createPanoramaxUploadSet(
  auth: PanoramaxAuth,
  title: string,
  estimatedFiles: number,
): Promise<string> {
  const response = await request(apiUrl(auth.instanceUrl, '/upload_sets'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.jwt}`,
    },
    body: JSON.stringify({
      title,
      estimated_nb_files: estimatedFiles,
      sort_method: 'time-asc',
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new PanoramaxAuthError();
  }
  if (!response.ok) {
    throw new Error(`Could not create the Panoramax upload set (${response.status})`);
  }
  const payload = await readJson<UploadSetResponse>(response);
  if (!payload.id) throw new Error('Panoramax upload set id missing');
  return payload.id;
}

async function uploadOneFile(
  auth: PanoramaxAuth,
  uploadSetId: string,
  capture: StreetViewCapture,
): Promise<'uploaded' | 'duplicate'> {
  const result = await FileSystem.uploadAsync(
    apiUrl(auth.instanceUrl, `/upload_sets/${uploadSetId}/files`),
    capture.localUri,
    {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      httpMethod: 'POST',
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.jwt}`,
      },
      parameters: {
        override_latitude: String(capture.lat),
        override_longitude: String(capture.lng),
        override_capture_time: new Date(capture.capturedAt).toISOString(),
        picture_id: capture.id,
        isBlurred: 'false',
      },
    },
  );

  if (result.status === 409) return 'duplicate';
  if (result.status === 401 || result.status === 403) throw new PanoramaxAuthError();
  if (result.status < 200 || result.status >= 300) {
    let detail = '';
    try {
      const parsed = JSON.parse(result.body) as { message?: string; detail?: string };
      detail = parsed.message ?? parsed.detail ?? '';
    } catch {
      detail = result.body?.slice(0, 160) ?? '';
    }
    throw new Error(
      `Panoramax rejected ${capture.id}${detail ? `: ${detail}` : ` (${result.status})`}`,
    );
  }
  return 'uploaded';
}

export async function completePanoramaxUploadSet(
  auth: PanoramaxAuth,
  uploadSetId: string,
): Promise<void> {
  const response = await request(apiUrl(auth.instanceUrl, `/upload_sets/${uploadSetId}/complete`), {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${auth.jwt}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new PanoramaxAuthError();
  }
  // Re-completing a set after a partial retry can race with the server's
  // dispatcher; a conflict means it is already complete.
  if (response.status === 409) return;
  if (!response.ok) {
    throw new Error(`Could not complete the Panoramax upload set (${response.status})`);
  }
}

export async function getPanoramaxUploadSet(
  auth: PanoramaxAuth,
  uploadSetId: string,
): Promise<UploadSetResponse> {
  const response = await request(apiUrl(auth.instanceUrl, `/upload_sets/${uploadSetId}`), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${auth.jwt}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new PanoramaxAuthError();
  }
  if (!response.ok) {
    throw new Error(`Could not read the Panoramax upload set (${response.status})`);
  }
  return readJson<UploadSetResponse>(response);
}

export interface PanoramaxUploadProgress {
  uploaded: number;
  failed: number;
  total: number;
}

export interface PanoramaxUploadResult {
  uploadSetId: string;
  uploaded: number;
  failed: number;
}

/**
 * Upload one drive. `estimatedFiles` is the full capture count so Panoramax can
 * show accurate progress; retries only send captures that are not uploaded.
 */
export async function uploadDriveToPanoramax(
  summary: StreetViewDriveSummary,
  auth: PanoramaxAuth,
  options: {
    wifiOnly: boolean;
    onProgress?: (progress: PanoramaxUploadProgress) => void;
  },
): Promise<PanoramaxUploadResult> {
  const net = await NetInfo.fetch();
  if (!net.isConnected) throw new PanoramaxNetworkError();
  if (options.wifiOnly && net.type !== 'wifi' && net.type !== 'ethernet') {
    throw new PanoramaxWifiOnlyError();
  }

  const batch = await getOrCreateUploadBatch(summary.drive.id, 'panoramax');
  let uploadSetId = batch.remoteBatchId;
  if (!uploadSetId) {
    const title = `Polaris street imagery ${new Date(
      summary.drive.startedAt,
    ).toLocaleDateString()}`;
    uploadSetId = await createPanoramaxUploadSet(auth, title, summary.captures.length);
    await updateUploadBatch(batch.id, {
      remoteBatchId: uploadSetId,
      status: 'uploading',
      total: summary.captures.length,
    });
  }

  const pending = await getPendingPanoramaxCaptures(summary.drive.id);
  let uploaded = summary.captures.filter(
    (capture) => capture.panoramaxStatus === 'uploaded',
  ).length;
  let failed = 0;

  for (const capture of pending) {
    await setCapturePanoramaxStatus(capture.id, 'uploading', {
      instance: auth.instanceUrl,
      pictureId: capture.id,
    });
    try {
      await uploadOneFile(auth, uploadSetId, capture);
      uploaded += 1;
      await setCapturePanoramaxStatus(capture.id, 'uploaded', {
        instance: auth.instanceUrl,
        pictureId: capture.id,
      });
    } catch (error) {
      if (error instanceof PanoramaxAuthError) {
        await updateUploadBatch(batch.id, { status: 'failed', error: error.message });
        await setDriveStatus(summary.drive.id, 'partial', error.message);
        throw error;
      }
      failed += 1;
      await setCapturePanoramaxStatus(capture.id, 'failed', {
        instance: auth.instanceUrl,
        pictureId: capture.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await updateUploadBatch(batch.id, { uploaded, failed, total: summary.captures.length });
    options.onProgress?.({ uploaded, failed, total: summary.captures.length });
  }

  // Keep the set open after a partial failure so a retry can append the
  // missing files; completing it would dispatch a partial collection and
  // reject later additions.
  if (failed === 0 && uploaded > 0) {
    await completePanoramaxUploadSet(auth, uploadSetId);
  }
  const status = failed === 0 ? 'complete' : uploaded > 0 ? 'partial' : 'failed';
  await updateUploadBatch(batch.id, {
    status,
    uploaded,
    failed,
    total: summary.captures.length,
  });
  await setDriveStatus(
    summary.drive.id,
    failed === 0 ? 'complete' : 'partial',
    failed === 0 ? null : `${failed} photo${failed === 1 ? '' : 's'} could not be uploaded`,
  );

  return { uploadSetId, uploaded, failed };
}
