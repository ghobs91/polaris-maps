import { getGun } from '../gun/init';
import { getDatabase } from '../database/init';
import { sign, createSigningPayload } from '../identity/signing';
import { getOrCreateKeypair } from '../identity/keypair';
import type { Review } from '../../models/review';

export async function getReviewsForPlace(placeUuid: string, limit: number = 50): Promise<Review[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReviewRow>(
    'SELECT * FROM reviews WHERE poi_uuid = ? ORDER BY created_at DESC LIMIT ?',
    [placeUuid, limit],
  );
  return rows.map(rowToReview);
}

export async function getReviewByAuthor(
  placeUuid: string,
  authorPubkey: string,
): Promise<Review | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReviewRow>(
    'SELECT * FROM reviews WHERE poi_uuid = ? AND author_pubkey = ?',
    [placeUuid, authorPubkey],
  );
  return row ? rowToReview(row) : null;
}

export async function createOrUpdateReview(
  placeUuid: string,
  rating: number,
  text?: string,
): Promise<Review> {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new Error('Rating must be an integer between 1 and 5');
  }

  const keypair = await getOrCreateKeypair();
  const now = Math.floor(Date.now() / 1000);

  const existing = await getReviewByAuthor(placeUuid, keypair.publicKey);

  const payload = createSigningPayload(placeUuid, keypair.publicKey, String(rating), String(now));
  const signature = await sign(payload, keypair.privateKey);

  const review: Review = {
    id: `${placeUuid}:${keypair.publicKey}`,
    poiUuid: placeUuid,
    authorPubkey: keypair.publicKey,
    rating,
    text: text ?? existing?.text,
    signature,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get('reviews')
    .get(placeUuid)
    .get(keypair.publicKey)
    .put({
      place_uuid: review.poiUuid,
      author_pubkey: review.authorPubkey,
      rating: review.rating,
      text: review.text ?? null,
      signature: review.signature,
      created_at: review.createdAt,
      updated_at: review.updatedAt,
    });

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO reviews (
      id, poi_uuid, author_pubkey, rating, text, signature, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      review.id,
      review.poiUuid,
      review.authorPubkey,
      review.rating,
      review.text ?? null,
      review.signature,
      review.createdAt,
      review.updatedAt,
    ],
  );

  await recomputeAvgRating(placeUuid);

  return review;
}

export async function deleteReview(placeUuid: string): Promise<void> {
  const keypair = await getOrCreateKeypair();

  const gun = getGun();
  (gun as any).get('polaris').get('reviews').get(placeUuid).get(keypair.publicKey).put(null);

  const db = await getDatabase();
  await db.runAsync('DELETE FROM reviews WHERE poi_uuid = ? AND author_pubkey = ?', [
    placeUuid,
    keypair.publicKey,
  ]);

  await recomputeAvgRating(placeUuid);
}

async function recomputeAvgRating(placeUuid: string): Promise<void> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ avg_r: number | null; cnt: number }>(
    'SELECT AVG(rating) as avg_r, COUNT(*) as cnt FROM reviews WHERE poi_uuid = ?',
    [placeUuid],
  );

  if (result) {
    await db.runAsync(
      'UPDATE places SET avg_rating = ?, review_count = ?, updated_at = ? WHERE uuid = ?',
      [result.avg_r, result.cnt, Math.floor(Date.now() / 1000), placeUuid],
    );

    const gun = getGun();
    (gun as any).get('polaris').get('poi_meta').get(placeUuid).put({
      avg_rating: result.avg_r,
      review_count: result.cnt,
    });
  }
}

interface ReviewRow {
  id: string;
  poi_uuid: string;
  author_pubkey: string;
  rating: number;
  text: string | null;
  signature: string;
  created_at: number;
  updated_at: number;
}

function rowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    poiUuid: row.poi_uuid,
    authorPubkey: row.author_pubkey,
    rating: row.rating,
    text: row.text ?? undefined,
    signature: row.signature,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
