import { getBlueskySession } from '../atproto/atprotoAuthService';
import { createOrUpdateReview } from '../poi/reviewService';
import type { ParsedGoogleReview } from './googleReviewsImport';
import { resolvePlaceForReview } from './reviewPlaceResolver';

/**
 * Background Google-reviews importer.
 *
 * Processes reviews strictly one at a time with a conservative pause between
 * Bluesky publishes (PDS `createRecord` calls are rate-limited per account;
 * bursting dozens of backdated reviews in parallel would earn 429s). The loop
 * is a plain sequential async task — no native background module — so it
 * keeps working while the app is foregrounded and resumes trivially: every
 * write is an idempotent per-author upsert, so re-running after the app was
 * killed simply continues where it left off (already-imported places are
 * overwritten with identical content).
 */

export const REVIEW_IMPORT_PACING_MS = 3000;

export interface ReviewImportProgress {
  total: number;
  completed: number;
  imported: number;
  unmatched: string[];
  failed: string[];
}

export type ReviewImportStatus = 'idle' | 'running' | 'done' | 'cancelled';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let runToken = 0;
let status: ReviewImportStatus = 'idle';
let progress: ReviewImportProgress = emptyProgress(0);
const listeners = new Set<
  (snapshot: { status: ReviewImportStatus; progress: ReviewImportProgress }) => void
>();

function emptyProgress(total: number): ReviewImportProgress {
  return { total, completed: 0, imported: 0, unmatched: [], failed: [] };
}

function emit(): void {
  const snapshot = {
    status,
    progress: { ...progress, unmatched: [...progress.unmatched], failed: [...progress.failed] },
  };
  for (const listener of listeners) listener(snapshot);
}

export function subscribeReviewImport(
  listener: (snapshot: { status: ReviewImportStatus; progress: ReviewImportProgress }) => void,
): () => void {
  listeners.add(listener);
  listener({ status, progress });
  return () => {
    listeners.delete(listener);
  };
}

export function getReviewImportSnapshot(): {
  status: ReviewImportStatus;
  progress: ReviewImportProgress;
} {
  return { status, progress };
}

/** Cancel the in-flight run after the current review finishes. */
export function cancelReviewImport(): void {
  runToken++;
  if (status === 'running') {
    status = 'cancelled';
    emit();
  }
}

/**
 * Import parsed Google reviews in the background, one by one.
 *
 * Requires an active Bluesky session (reviews are published to the user's
 * PDS). Reviews whose place cannot be matched locally are skipped and
 * reported as unmatched — never fabricated. Individual failures never abort
 * the run; they are collected into `progress.failed`.
 */
export async function startReviewImport(
  reviews: ParsedGoogleReview[],
  options?: { pacingMs?: number },
): Promise<ReviewImportProgress> {
  const session = await getBlueskySession();
  if (!session) {
    throw new Error('Sign in to Bluesky first — imported reviews are published to your account.');
  }

  const token = ++runToken;
  status = 'running';
  progress = emptyProgress(reviews.length);
  emit();

  for (const review of reviews) {
    if (token !== runToken) break;

    try {
      const resolved = await resolvePlaceForReview(review.lat, review.lng, review.name);
      if (token !== runToken) break;
      if (!resolved) {
        progress.unmatched.push(review.name);
      } else {
        await createOrUpdateReview(
          resolved.place.uuid,
          review.rating,
          review.text,
          resolved.context,
          undefined,
          review.createdAt ? { createdAt: review.createdAt } : undefined,
        );
        progress.imported++;
      }
    } catch (err) {
      console.warn('[review-import] failed for', review.name, err);
      progress.failed.push(review.name);
    }

    progress.completed++;
    emit();

    // Pace Bluesky writes: fixed delay plus small jitter so retries across
    // users don't thunder back in lockstep. Skipped between items only —
    // never before the first, never after the last.
    if (progress.completed < progress.total && token === runToken) {
      const pacing = options?.pacingMs ?? REVIEW_IMPORT_PACING_MS;
      await sleep(pacing + Math.floor(Math.random() * 1000));
    }
  }

  if (token === runToken) {
    status = 'done';
    emit();
  }
  return progress;
}
