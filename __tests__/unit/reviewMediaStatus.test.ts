import {
  applyReviewMediaStatus,
  isMediaVisible,
  isPublishable,
  REVIEW_MEDIA_STATUSES,
  transitionReviewMediaStatus,
  visibleReviewMedia,
} from '../../src/services/poi/reviewMediaStatus';
import type { Review, ReviewMedia } from '../../src/models/review';

function media(hash: string, status: ReviewMedia['status']): ReviewMedia {
  return { hash, width: 100, height: 100, mime: 'image/jpeg', status, createdAt: 1 };
}

function review(id: string, items: ReviewMedia[]): Review {
  return {
    id,
    poiUuid: 'place1',
    authorPubkey: 'pub1',
    rating: 4,
    signature: 'sig',
    createdAt: 1,
    updatedAt: 1,
    source: 'anonymous',
    media: items,
  };
}

describe('review media status transitions', () => {
  it('publishes only from local', () => {
    expect(transitionReviewMediaStatus('local', 'publish')).toBe('published');
    expect(isPublishable('local')).toBe(true);

    for (const status of ['published', 'reported', 'hidden'] as const) {
      expect(() => transitionReviewMediaStatus(status, 'publish')).toThrow(/Cannot publish/);
      expect(isPublishable(status)).toBe(false);
    }
  });

  it('never re-publishes a reported or hidden hash', () => {
    const reported = transitionReviewMediaStatus('published', 'report');
    expect(reported).toBe('reported');
    expect(() => transitionReviewMediaStatus(reported, 'publish')).toThrow();

    const hidden = transitionReviewMediaStatus(reported, 'hide');
    expect(hidden).toBe('hidden');
    expect(() => transitionReviewMediaStatus(hidden, 'publish')).toThrow();
  });

  it('report hides immediately and is idempotent', () => {
    expect(transitionReviewMediaStatus('local', 'report')).toBe('reported');
    expect(transitionReviewMediaStatus('reported', 'report')).toBe('reported');
    expect(transitionReviewMediaStatus('hidden', 'report')).toBe('hidden');
  });

  it('hide wins over published but not over reported identity', () => {
    expect(transitionReviewMediaStatus('published', 'hide')).toBe('hidden');
    expect(transitionReviewMediaStatus('reported', 'hide')).toBe('hidden');
  });

  it('exposes the documented status set', () => {
    expect([...REVIEW_MEDIA_STATUSES]).toEqual(['local', 'published', 'reported', 'hidden']);
  });
});

describe('review media visibility', () => {
  it('withholds reported and hidden media from viewers', () => {
    expect(isMediaVisible('local')).toBe(true);
    expect(isMediaVisible('published')).toBe(true);
    expect(isMediaVisible('reported')).toBe(false);
    expect(isMediaVisible('hidden')).toBe(false);
  });

  it('filters a review down to visible media only', () => {
    const r = review('r1', [
      media('a', 'published'),
      media('b', 'reported'),
      media('c', 'hidden'),
      media('d', 'local'),
    ]);

    expect(visibleReviewMedia(r).map((m) => m.hash)).toEqual(['a', 'd']);
  });

  it('returns an empty list for a review without media', () => {
    const r = review('r1', []);
    delete r.media;
    expect(visibleReviewMedia(r)).toEqual([]);
  });
});

describe('applyReviewMediaStatus', () => {
  it('updates only the matching hash and leaves other reviews untouched', () => {
    const reviews = [
      review('r1', [media('a', 'local'), media('b', 'local')]),
      review('r2', [media('c', 'local')]),
    ];

    const updated = applyReviewMediaStatus(reviews, 'a', 'report');

    expect(updated[0].media?.map((m) => m.status)).toEqual(['reported', 'local']);
    expect(updated[1].media?.map((m) => m.status)).toEqual(['local']);
  });

  it('throws when an illegal publish is attempted through the helper', () => {
    const reviews = [review('r1', [media('a', 'reported')])];
    expect(() => applyReviewMediaStatus(reviews, 'a', 'publish')).toThrow(/Cannot publish/);
  });
});
