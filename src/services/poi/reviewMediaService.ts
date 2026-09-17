import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, type Action, type ImageResult } from 'expo-image-manipulator';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { getGun } from '../gun/init';
import { useSettingsStore } from '../../stores/settingsStore';
import { transitionReviewMediaStatus } from './reviewMediaStatus';
import type { ReviewMedia } from '../../models/review';

/**
 * On-device storage + publication for review photos.
 *
 * Attach pipeline: downscale to a bounded longest edge, render a thumbnail,
 * strip EXIF/GPS (ImageManipulator decodes and re-encodes, so no metadata
 * survives), then content-address the bytes and write to the app documents
 * directory. Publication is opt-in: only explicitly shared photos are written
 * to the Gun metadata namespace; byte transfer over Hyperdrive shares the same
 * native-bridge boundary as street imagery (see `../imagery/uploadService.ts`).
 */

export const REVIEW_MEDIA_MAX_EDGE = 1600;
export const REVIEW_MEDIA_THUMB_EDGE = 320;
export const REVIEW_MEDIA_MAX_PER_REVIEW = 6;
export const REVIEW_MEDIA_QUALITY = 0.8;
export const REVIEW_MEDIA_THUMB_QUALITY = 0.7;
export const REVIEW_MEDIA_DIR = 'review-media/';
/** Gun namespace holding content-addressed media metadata for published photos. */
export const REVIEW_MEDIA_NAMESPACE = 'review_media';

export type ReviewMediaVariant = 'full' | 'thumb';

export interface PreparedReviewMedia {
  /** Metadata ready to persist through `reviewService`. */
  media: ReviewMedia;
  /** Absolute URI of the downscaled full-size JPEG. */
  uri: string;
  /** Absolute URI of the thumbnail JPEG (keyed by the full-content hash). */
  thumbUri: string;
}

/**
 * Resize action that bounds the longest edge, or null when the image already
 * fits. Passing only width or height preserves the aspect ratio.
 */
export function boundingResize(width: number, height: number, maxEdge: number): Action | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions');
  }
  if (Math.max(width, height) <= maxEdge) return null;
  return width >= height ? { resize: { width: maxEdge } } : { resize: { height: maxEdge } };
}

function documentRoot(): string {
  return FileSystem.documentDirectory ?? '';
}

export function reviewMediaDir(): string {
  return `${documentRoot()}${REVIEW_MEDIA_DIR}`;
}

/** Deterministic path for a content hash. Thumbnails reuse the full hash. */
export function reviewMediaFilePath(hash: string, variant: ReviewMediaVariant = 'full'): string {
  return `${reviewMediaDir()}${hash}${variant === 'thumb' ? '.thumb' : ''}.jpg`;
}

async function hashFile(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, base64);
}

async function renderBounded(
  inputUri: string,
  width: number,
  height: number,
  maxEdge: number,
  compress: number,
): Promise<ImageResult> {
  const action = boundingResize(width, height, maxEdge);
  return manipulateAsync(inputUri, action ? [action] : [], { compress, format: 'jpeg' as const });
}

/** Move a rendered temp file into its content-addressed final location. */
async function persist(uri: string, dest: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } else {
    await FileSystem.moveAsync({ from: uri, to: dest });
  }
  return dest;
}

/** Downscale, thumbnail, strip EXIF/GPS, hash, and store a picked photo. */
export async function attachReviewPhoto(inputUri: string): Promise<PreparedReviewMedia> {
  await FileSystem.makeDirectoryAsync(reviewMediaDir(), { intermediates: true });

  const probe = await manipulateAsync(inputUri, [], { compress: 1, format: 'jpeg' as const });
  const full = await renderBounded(
    inputUri,
    probe.width,
    probe.height,
    REVIEW_MEDIA_MAX_EDGE,
    REVIEW_MEDIA_QUALITY,
  );
  const thumb = await renderBounded(
    inputUri,
    probe.width,
    probe.height,
    REVIEW_MEDIA_THUMB_EDGE,
    REVIEW_MEDIA_THUMB_QUALITY,
  );

  const hash = await hashFile(full.uri);
  const uri = await persist(full.uri, reviewMediaFilePath(hash, 'full'));
  const thumbUri = await persist(thumb.uri, reviewMediaFilePath(hash, 'thumb'));

  return {
    media: {
      hash,
      width: full.width,
      height: full.height,
      mime: 'image/jpeg',
      status: 'local',
      createdAt: Math.floor(Date.now() / 1000),
    },
    uri,
    thumbUri,
  };
}

/** Local-first resolution: returns the cached file URI, or null for a miss. */
export async function resolveReviewMediaUri(
  hash: string,
  variant: ReviewMediaVariant = 'full',
): Promise<string | null> {
  const path = reviewMediaFilePath(hash, variant);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? info.uri : null;
}

/** Remove a photo's full-size and thumbnail files (idempotent). */
export async function removeReviewMediaFiles(hash: string): Promise<void> {
  await FileSystem.deleteAsync(reviewMediaFilePath(hash, 'full'), { idempotent: true });
  await FileSystem.deleteAsync(reviewMediaFilePath(hash, 'thumb'), { idempotent: true });
}

/**
 * Publish a photo's metadata to peers (opt-in). Gated on the user-controlled
 * `reviewPhotoSharingEnabled` permission; only `local` media may transition.
 */
export async function publishReviewMedia(media: ReviewMedia): Promise<ReviewMedia> {
  if (!useSettingsStore.getState().permissions.reviewPhotoSharingEnabled) {
    throw new Error(
      'Review photo sharing is disabled. Enable it in Settings to share photos with peers.',
    );
  }

  const status = transitionReviewMediaStatus(media.status, 'publish');
  const gun = getGun();
  (gun as any).get('polaris').get(REVIEW_MEDIA_NAMESPACE).get(media.hash).put({
    hash: media.hash,
    width: media.width,
    height: media.height,
    mime: media.mime,
    created_at: media.createdAt,
    deleted: false,
  });

  return { ...media, status };
}

/**
 * Tombstone a photo for peers so a reported/hidden hash is never re-published
 * or retrieved again.
 */
export function tombstoneReviewMedia(hash: string): void {
  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get(REVIEW_MEDIA_NAMESPACE)
    .get(hash)
    .put({
      hash,
      deleted: true,
      deleted_at: Math.floor(Date.now() / 1000),
    });
}
