import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { encode as geohashEncode } from '../../utils/geohash';
import { getOrCreateKeypair } from '../identity/keypair';
import { sign, createSigningPayload } from '../identity/signing';
import type { StreetImagery } from '../../models/imagery';

const CAPTURE_DIR = `${FileSystem.documentDirectory}captures/`;

interface CaptureResult {
  localUri: string;
  metadata: Omit<
    StreetImagery,
    'imageHash' | 'hypercoreFeedKey' | 'feedSeq' | 'blurred' | 'signature'
  >;
}

let captureInterval: ReturnType<typeof setInterval> | null = null;
let captureCallback: ((result: CaptureResult) => void) | null = null;
let captureCount = 0;

export async function initCaptureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CAPTURE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CAPTURE_DIR, { intermediates: true });
  }
}

export async function captureImage(
  photoUri: string,
  width: number,
  height: number,
): Promise<CaptureResult> {
  const keypair = await getOrCreateKeypair();
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const now = Math.floor(Date.now() / 1000);

  const id = Crypto.randomUUID();
  const destUri = `${CAPTURE_DIR}${id}.jpg`;
  await FileSystem.copyAsync({ from: photoUri, to: destUri });

  const geohash8 = geohashEncode(location.coords.latitude, location.coords.longitude, 8);
  const bearing = Math.round(location.coords.heading ?? 0) % 360;

  return {
    localUri: destUri,
    metadata: {
      id,
      authorPubkey: keypair.publicKey,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      geohash8,
      bearing,
      capturedAt: now,
      width,
      height,
    },
  };
}

export function startIntervalCapture(
  intervalMs: number,
  onCapture: (result: CaptureResult) => void,
): void {
  stopIntervalCapture();
  captureCallback = onCapture;
  captureCount = 0;
  // The actual camera trigger is driven by the UI component;
  // this interval just signals when to take the next shot.
  captureInterval = setInterval(() => {
    captureCount++;
    // The UI should check shouldCapture() and trigger capture
  }, intervalMs);
}

export function stopIntervalCapture(): void {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  captureCallback = null;
  captureCount = 0;
}

export function getCaptureCount(): number {
  return captureCount;
}

export async function signImageryMetadata(
  metadata: CaptureResult['metadata'],
  imageHash: string,
  feedKey: string,
  feedSeq: number,
  blurred: boolean,
): Promise<StreetImagery> {
  const keypair = await getOrCreateKeypair();
  const payload = createSigningPayload(
    metadata.id,
    imageHash,
    String(metadata.lat),
    String(metadata.lng),
    String(metadata.capturedAt),
  );
  const signature = await sign(payload, keypair.privateKey);

  return {
    ...metadata,
    imageHash,
    hypercoreFeedKey: feedKey,
    feedSeq,
    blurred,
    signature,
  };
}

export async function getQueuedCaptures(): Promise<string[]> {
  const info = await FileSystem.getInfoAsync(CAPTURE_DIR);
  if (!info.exists) return [];
  const files = await FileSystem.readDirectoryAsync(CAPTURE_DIR);
  return files.filter((f) => f.endsWith('.jpg')).map((f) => `${CAPTURE_DIR}${f}`);
}

export async function deleteCapture(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
