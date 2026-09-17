import type { Review, ReviewMedia } from '../../models/review';

/**
 * Pure moderation state machine for review photos.
 *
 * Transitions: `local → published | reported | hidden`. Publication is opt-in
 * and one-way — a reported or hidden photo is never re-published, so a peer
 * cannot resurrect abusive content by echoing the hash back.
 */
export type ReviewMediaStatus = ReviewMedia['status'];
export type ReviewMediaAction = 'publish' | 'report' | 'hide';

export const REVIEW_MEDIA_STATUSES: readonly ReviewMediaStatus[] = [
  'local',
  'published',
  'reported',
  'hidden',
];

/** Only never-touched local media may be published (one-way, opt-in). */
export function isPublishable(status: ReviewMediaStatus): boolean {
  return status === 'local';
}

/** Reported/hidden media is withheld from the gallery for this device. */
export function isMediaVisible(status: ReviewMediaStatus): boolean {
  return status !== 'reported' && status !== 'hidden';
}

export function transitionReviewMediaStatus(
  current: ReviewMediaStatus,
  action: ReviewMediaAction,
): ReviewMediaStatus {
  switch (action) {
    case 'publish':
      if (!isPublishable(current)) {
        throw new Error(`Cannot publish review media with status "${current}"`);
      }
      return 'published';
    case 'report':
      // Reporting hides it immediately for the reporter; hidden stays hidden.
      return current === 'hidden' ? 'hidden' : 'reported';
    case 'hide':
      return 'hidden';
  }
}

/** Apply a moderation action to one hash, returning updated review copies. */
export function applyReviewMediaStatus(
  reviews: readonly Review[],
  hash: string,
  action: ReviewMediaAction,
): Review[] {
  return reviews.map((review) => {
    if (!review.media?.some((m) => m.hash === hash)) return review;
    return {
      ...review,
      media: review.media.map((media) =>
        media.hash === hash
          ? { ...media, status: transitionReviewMediaStatus(media.status, action) }
          : media,
      ),
    };
  });
}

/** Media a viewer should see (excludes reported/hidden). */
export function visibleReviewMedia(review: Review): ReviewMedia[] {
  return (review.media ?? []).filter((media) => isMediaVisible(media.status));
}
