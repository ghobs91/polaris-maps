import * as FileSystem from 'expo-file-system';
import { getGun } from '../gun/init';
import { getDatabase } from '../database/init';
import { blurImage, computeImageHash } from './blurService';
import { signImageryMetadata, deleteCapture } from './captureService';
import type { StreetImagery } from '../../models/imagery';

// Note: Actual Hypercore feed write requires the native bridge from src/native/hypercore.
// This service orchestrates the blur → hash → upload → metadata flow.

export async function uploadImage(
  localUri: string,
  metadata: Parameters<typeof signImageryMetadata>[0],
): Promise<StreetImagery> {
  // 1. Blur faces/plates
  const blurResult = await blurImage(localUri);

  // 2. Compute hash of blurred image
  const imageHash = await computeImageHash(blurResult.outputUri);

  // 3. Upload to Hypercore (placeholder — needs native bridge write)
  // In production, the blurred image bytes are appended to the user's Hypercore feed.
  const feedKey = 'placeholder-feed-key'; // Would come from Hypercore native module
  const feedSeq = 0; // Would be returned by Hypercore append

  // 4. Sign metadata
  const imagery = await signImageryMetadata(
    metadata,
    imageHash,
    feedKey,
    feedSeq,
    blurResult.blurred,
  );

  // 5. Store metadata in Gun.js
  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get('imagery')
    .get(imagery.geohash8)
    .get(imagery.id)
    .put({
      id: imagery.id,
      author_pubkey: imagery.authorPubkey,
      lat: imagery.lat,
      lng: imagery.lng,
      geohash8: imagery.geohash8,
      bearing: imagery.bearing,
      captured_at: imagery.capturedAt,
      image_hash: imagery.imageHash,
      hypercore_feed_key: imagery.hypercoreFeedKey,
      feed_seq: imagery.feedSeq,
      width: imagery.width,
      height: imagery.height,
      blurred: imagery.blurred ? 1 : 0,
      signature: imagery.signature,
    });

  // 6. Cache metadata in SQLite
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO street_imagery (
      id, author_pubkey, lat, lng, geohash8, bearing, captured_at,
      image_hash, hypercore_feed_key, feed_seq, width, height, blurred, signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      imagery.id,
      imagery.authorPubkey,
      imagery.lat,
      imagery.lng,
      imagery.geohash8,
      imagery.bearing,
      imagery.capturedAt,
      imagery.imageHash,
      imagery.hypercoreFeedKey,
      imagery.feedSeq,
      imagery.width,
      imagery.height,
      imagery.blurred ? 1 : 0,
      imagery.signature,
    ],
  );

  // 7. Clean up local file
  await deleteCapture(localUri);
  if (blurResult.outputUri !== localUri) {
    await FileSystem.deleteAsync(blurResult.outputUri, { idempotent: true });
  }

  return imagery;
}
