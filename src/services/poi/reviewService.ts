import { getGun } from '../gun/init';
import { getDatabase } from '../database/init';
import { sign, createSigningPayload } from '../identity/signing';
import { getOrCreateKeypair } from '../identity/keypair';
import { getBlueskySession } from '../atproto/atprotoAuthService';
import {
  publishReviewToAtproto,
  fetchReviewsFromAtproto,
  deleteReviewFromAtproto,
} from '../atproto/atprotoReviewService';
import { assertPoiContributionEnabled } from './contributionGate';
import {
  publishReviewMedia as publishReviewMediaToPeers,
  removeReviewMediaFiles,
  tombstoneReviewMedia,
} from './reviewMediaService';
import type { Review, ReviewMedia, PlaceReviewContext } from '../../models/review';

export async function getReviewsForPlace(placeUuid: string, limit: number = 50): Promise<Review[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReviewRow>(
    'SELECT * FROM reviews WHERE poi_uuid = ? ORDER BY created_at DESC LIMIT ?',
    [placeUuid, limit],
  );
  const localReviews = rows.map(rowToReview);
  await attachMediaToReviews(localReviews);

  // Fetch ATProto reviews (returns [] if no session — always safe)
  const atprotoReviews = await fetchReviewsFromAtproto(placeUuid);

  // Merge and deduplicate
  const merged = new Map<string, Review>();
  for (const r of localReviews) {
    merged.set(r.id, r);
  }

  // Build set of locally-cached ATProto URIs for dedup
  const localAtprotoUris = new Set(
    localReviews.filter((r) => r.atprotoUri).map((r) => r.atprotoUri),
  );

  for (const r of atprotoReviews) {
    if (r.atprotoUri && localAtprotoUris.has(r.atprotoUri)) continue;
    if (!merged.has(r.id)) {
      merged.set(r.id, r);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
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
  if (!row) return null;
  const review = rowToReview(row);
  await attachMediaToReviews([review]);
  return review;
}

export async function getReviewMedia(reviewId: string): Promise<ReviewMedia[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReviewMediaRow>(
    'SELECT * FROM review_media WHERE review_id = ? ORDER BY created_at ASC',
    [reviewId],
  );
  return rows.map(mediaRowToReviewMedia);
}

/** Replace the stored media for a review (delete-then-insert). */
export async function saveReviewMedia(
  reviewId: string,
  media: readonly ReviewMedia[],
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM review_media WHERE review_id = ?', [reviewId]);
  for (const item of media) {
    await db.runAsync(
      `INSERT OR REPLACE INTO review_media (
        review_id, hash, width, height, mime, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reviewId, item.hash, item.width, item.height, item.mime, item.status, item.createdAt],
    );
  }
}

async function setReviewMediaStatus(
  reviewId: string,
  hash: string,
  status: ReviewMedia['status'],
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE review_media SET status = ? WHERE review_id = ? AND hash = ?', [
    status,
    reviewId,
    hash,
  ]);
}

async function findReviewMedia(reviewId: string, hash: string): Promise<ReviewMedia | null> {
  const media = await getReviewMedia(reviewId);
  return media.find((item) => item.hash === hash) ?? null;
}

/** Publish one local photo to peers (opt-in) and record the new status. */
export async function publishReviewMedia(reviewId: string, hash: string): Promise<void> {
  const media = await findReviewMedia(reviewId, hash);
  if (!media) throw new Error(`Review media ${hash} not found`);
  await publishReviewMediaToPeers(media);
  await setReviewMediaStatus(reviewId, hash, 'published');
}

/** Report a photo: hide it locally and tombstone the hash for peers. */
export async function reportReviewMedia(reviewId: string, hash: string): Promise<void> {
  await setReviewMediaStatus(reviewId, hash, 'reported');
  tombstoneReviewMedia(hash);
}

/** Hide a photo without reporting it. */
export async function hideReviewMedia(reviewId: string, hash: string): Promise<void> {
  await setReviewMediaStatus(reviewId, hash, 'hidden');
  tombstoneReviewMedia(hash);
}

/** Delete stored media rows and their local files for the given reviews. */
async function deleteReviewMediaRows(reviewIds: readonly string[]): Promise<void> {
  if (reviewIds.length === 0) return;
  const db = await getDatabase();
  const placeholders = reviewIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{ hash: string }>(
    `SELECT hash FROM review_media WHERE review_id IN (${placeholders})`,
    [...reviewIds],
  );
  await db.runAsync(`DELETE FROM review_media WHERE review_id IN (${placeholders})`, [
    ...reviewIds,
  ]);
  await Promise.all(rows.map((row) => removeReviewMediaFiles(row.hash)));
}

async function attachMediaToReviews(reviews: Review[]): Promise<void> {
  if (reviews.length === 0) return;
  const db = await getDatabase();
  const placeholders = reviews.map(() => '?').join(', ');
  const rows = await db.getAllAsync<ReviewMediaRow>(
    `SELECT * FROM review_media WHERE review_id IN (${placeholders}) ORDER BY created_at ASC`,
    reviews.map((review) => review.id),
  );
  const byReview = new Map<string, ReviewMedia[]>();
  for (const row of rows) {
    const list = byReview.get(row.review_id) ?? [];
    list.push(mediaRowToReviewMedia(row));
    byReview.set(row.review_id, list);
  }
  for (const review of reviews) {
    const media = byReview.get(review.id);
    if (media && media.length > 0) review.media = media;
  }
}

export async function createOrUpdateReview(
  placeUuid: string,
  rating: number,
  text?: string,
  placeContext?: PlaceReviewContext,
  media?: ReviewMedia[],
  options?: { createdAt?: number },
): Promise<Review> {
  assertPoiContributionEnabled();
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new Error('Rating must be an integer between 1 and 5');
  }

  const session = await getBlueskySession();
  // Imported (e.g. Google Takeout) reviews keep their original timestamp so
  // timelines stay honest; freshly written reviews use the current time.
  const now = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const db = await getDatabase();
  const gun = getGun();

  if (session) {
    // ── Bluesky mode ──
    const review: Review = {
      id: `${placeUuid}:${session.did}`,
      poiUuid: placeUuid,
      authorPubkey: session.did,
      authorHandle: session.handle,
      rating,
      text: text ?? undefined,
      signature: '',
      createdAt: now,
      updatedAt: now,
      source: 'atproto',
      media: media && media.length > 0 ? media : undefined,
    };

    const context: PlaceReviewContext = placeContext ?? {
      poiUuid: placeUuid,
      source: 'polaris',
    };

    try {
      const uri = await publishReviewToAtproto(review, context);
      review.atprotoUri = uri;
      review.id = uri;
    } catch (err) {
      console.warn('ATProto publish failed, continuing with local-only:', err);
    }

    (gun as any)
      .get('polaris')
      .get('reviews')
      .get(placeUuid)
      .get(session.did)
      .put({
        place_uuid: review.poiUuid,
        author_pubkey: review.authorPubkey,
        rating: review.rating,
        text: review.text ?? null,
        signature: review.signature,
        created_at: review.createdAt,
        updated_at: review.updatedAt,
        media: review.media ?? null,
      });

    await db.runAsync(
      `INSERT OR REPLACE INTO reviews (
        id, poi_uuid, author_pubkey, rating, text, signature, created_at, updated_at,
        source, atproto_uri, author_handle
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        review.id,
        review.poiUuid,
        review.authorPubkey,
        review.rating,
        review.text ?? null,
        review.signature,
        review.createdAt,
        review.updatedAt,
        review.source,
        review.atprotoUri ?? null,
        review.authorHandle ?? null,
      ],
    );

    if (media) await saveReviewMedia(review.id, media);

    await recomputeAvgRating(placeUuid);
    return review;
  }

  // ── Anonymous mode (unchanged logic) ──
  const keypair = await getOrCreateKeypair();
  const existing = await getReviewByAuthor(placeUuid, keypair.publicKey);

  const payload = createSigningPayload(placeUuid, keypair.publicKey, String(rating), String(now));
  const signature = await sign(payload, keypair.privateKey);

  const resolvedMedia = media ?? existing?.media;
  const review: Review = {
    id: `${placeUuid}:${keypair.publicKey}`,
    poiUuid: placeUuid,
    authorPubkey: keypair.publicKey,
    rating,
    text: text ?? existing?.text,
    signature,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source: 'anonymous',
    media: resolvedMedia && resolvedMedia.length > 0 ? resolvedMedia : undefined,
  };

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
      media: review.media ?? null,
    });

  await db.runAsync(
    `INSERT OR REPLACE INTO reviews (
      id, poi_uuid, author_pubkey, rating, text, signature, created_at, updated_at,
      source, atproto_uri, author_handle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      review.id,
      review.poiUuid,
      review.authorPubkey,
      review.rating,
      review.text ?? null,
      review.signature,
      review.createdAt,
      review.updatedAt,
      review.source,
      null,
      null,
    ],
  );

  if (media) await saveReviewMedia(review.id, media);

  await recomputeAvgRating(placeUuid);
  return review;
}

export async function deleteReview(placeUuid: string): Promise<void> {
  assertPoiContributionEnabled();
  const session = await getBlueskySession();
  const gun = getGun();
  const db = await getDatabase();

  if (session) {
    // Check for ATProto URI on the local record
    const existing = await db.getFirstAsync<{ id: string; atproto_uri: string | null }>(
      'SELECT id, atproto_uri FROM reviews WHERE poi_uuid = ? AND author_pubkey = ?',
      [placeUuid, session.did],
    );
    if (existing?.atproto_uri) {
      try {
        await deleteReviewFromAtproto(existing.atproto_uri);
      } catch (err) {
        console.warn('ATProto delete failed:', err);
      }
    }
    if (existing) await deleteReviewMediaRows([existing.id]);
    (gun as any).get('polaris').get('reviews').get(placeUuid).get(session.did).put(null);
    await db.runAsync('DELETE FROM reviews WHERE poi_uuid = ? AND author_pubkey = ?', [
      placeUuid,
      session.did,
    ]);
  } else {
    const keypair = await getOrCreateKeypair();
    await deleteReviewMediaRows([`${placeUuid}:${keypair.publicKey}`]);
    (gun as any).get('polaris').get('reviews').get(placeUuid).get(keypair.publicKey).put(null);
    await db.runAsync('DELETE FROM reviews WHERE poi_uuid = ? AND author_pubkey = ?', [
      placeUuid,
      keypair.publicKey,
    ]);
  }

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
  source: string | null;
  atproto_uri: string | null;
  author_handle: string | null;
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
    source: (row.source as Review['source']) ?? 'anonymous',
    atprotoUri: row.atproto_uri ?? undefined,
    authorHandle: row.author_handle ?? undefined,
  };
}

interface ReviewMediaRow {
  review_id: string;
  hash: string;
  width: number;
  height: number;
  mime: string;
  status: string;
  created_at: number;
}

function mediaRowToReviewMedia(row: ReviewMediaRow): ReviewMedia {
  return {
    hash: row.hash,
    width: row.width,
    height: row.height,
    mime: row.mime,
    status: (row.status as ReviewMedia['status']) ?? 'local',
    createdAt: row.created_at,
  };
}
