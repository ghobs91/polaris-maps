/**
 * Tests for reviewService.ts — dual-backend review system with merged reads,
 * media persistence, and moderation actions.
 */

// Mock Gun.js
jest.mock('../../src/services/gun/init', () => {
  const mockPut = jest.fn();
  const mockGet: jest.Mock = jest.fn(() => ({
    get: mockGet,
    put: mockPut,
  }));
  return {
    getGun: jest.fn(() => ({ get: mockGet })),
    __mockGunPut: mockPut,
    __mockGunGet: mockGet,
  };
});

// Mock database
jest.mock('../../src/services/database/init', () => {
  const db = {
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue(undefined),
  };
  return { getDatabase: jest.fn().mockResolvedValue(db), __mockDb: db };
});

// Mock identity
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn().mockResolvedValue({
    publicKey: 'a'.repeat(64),
    privateKey: new Uint8Array(32),
  }),
}));

jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn().mockResolvedValue('sig_' + 'a'.repeat(128)),
  createSigningPayload: jest.fn((...args: string[]) => args.join('\0')),
}));

// Mock ATProto services
jest.mock('../../src/services/atproto/atprotoAuthService', () => ({
  getBlueskySession: jest.fn(),
}));

jest.mock('../../src/services/atproto/atprotoReviewService', () => ({
  publishReviewToAtproto: jest.fn(),
  fetchReviewsFromAtproto: jest.fn(),
  deleteReviewFromAtproto: jest.fn(),
}));

// Mock the media transport so the native image/file modules stay out of this suite.
jest.mock('../../src/services/poi/reviewMediaService', () => ({
  publishReviewMedia: jest.fn(),
  removeReviewMediaFiles: jest.fn(),
  tombstoneReviewMedia: jest.fn(),
}));

import {
  getReviewsForPlace,
  createOrUpdateReview,
  deleteReview,
  getReviewMedia,
  publishReviewMedia,
  reportReviewMedia,
  hideReviewMedia,
} from '../../src/services/poi/reviewService';
import { getBlueskySession } from '../../src/services/atproto/atprotoAuthService';
import {
  publishReviewToAtproto,
  fetchReviewsFromAtproto,
  deleteReviewFromAtproto,
} from '../../src/services/atproto/atprotoReviewService';
import {
  publishReviewMedia as publishReviewMediaToPeers,
  removeReviewMediaFiles,
  tombstoneReviewMedia,
} from '../../src/services/poi/reviewMediaService';
import type { Review, ReviewMedia } from '../../src/models/review';

const mockGetBlueskySession = getBlueskySession as jest.MockedFunction<typeof getBlueskySession>;
const mockPublishReviewToAtproto = publishReviewToAtproto as jest.MockedFunction<
  typeof publishReviewToAtproto
>;
const mockFetchReviewsFromAtproto = fetchReviewsFromAtproto as jest.MockedFunction<
  typeof fetchReviewsFromAtproto
>;
const mockDeleteReviewFromAtproto = deleteReviewFromAtproto as jest.MockedFunction<
  typeof deleteReviewFromAtproto
>;
const mockPublishReviewMediaToPeers = publishReviewMediaToPeers as jest.MockedFunction<
  typeof publishReviewMediaToPeers
>;
const mockRemoveReviewMediaFiles = removeReviewMediaFiles as jest.MockedFunction<
  typeof removeReviewMediaFiles
>;
const mockTombstoneReviewMedia = tombstoneReviewMedia as jest.MockedFunction<
  typeof tombstoneReviewMedia
>;

const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: { getAllAsync: jest.Mock; getFirstAsync: jest.Mock; runAsync: jest.Mock };
};
const { __mockGunPut: mockGunPut } = jest.requireMock('../../src/services/gun/init') as {
  __mockGunPut: jest.Mock;
};

let reviewRows: Record<string, unknown>[] = [];
let mediaRows: Record<string, unknown>[] = [];

function mediaRow(reviewId: string, hash: string, status = 'local') {
  return {
    review_id: reviewId,
    hash,
    width: 1600,
    height: 800,
    mime: 'image/jpeg',
    status,
    created_at: 1700000000,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  reviewRows = [];
  mediaRows = [];
  mockGetBlueskySession.mockResolvedValue(null);
  mockFetchReviewsFromAtproto.mockResolvedValue([]);
  mockDb.getAllAsync.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM review_media')) return mediaRows;
    if (sql.includes('FROM reviews')) return reviewRows;
    return [];
  });
  mockDb.getFirstAsync.mockImplementation(async (sql: string) => {
    if (sql.includes('AVG(rating)')) return { avg_r: 4, cnt: 1 };
    if (sql.includes('FROM reviews')) return reviewRows[0] ?? null;
    return null;
  });
  mockDb.runAsync.mockResolvedValue(undefined);
});

describe('getReviewsForPlace', () => {
  it('returns local reviews only when no session', async () => {
    reviewRows = [
      {
        id: 'place1:pubkey1',
        poi_uuid: 'place1',
        author_pubkey: 'pubkey1',
        rating: 4,
        text: 'Nice!',
        signature: 'sig1',
        created_at: 1700000000,
        updated_at: 1700000000,
        source: 'anonymous',
        atproto_uri: null,
        author_handle: null,
      },
    ];

    const result = await getReviewsForPlace('place1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('place1:pubkey1');
    expect(result[0].source).toBe('anonymous');
  });

  it('attaches media rows to the matching review', async () => {
    reviewRows = [
      {
        id: 'place1:pubkey1',
        poi_uuid: 'place1',
        author_pubkey: 'pubkey1',
        rating: 4,
        text: 'Nice!',
        signature: 'sig1',
        created_at: 1700000000,
        updated_at: 1700000000,
        source: 'anonymous',
        atproto_uri: null,
        author_handle: null,
      },
    ];
    mediaRows = [mediaRow('place1:pubkey1', 'hash1'), mediaRow('place1:pubkey1', 'hash2')];

    const result = await getReviewsForPlace('place1');

    expect(result[0].media?.map((m) => m.hash)).toEqual(['hash1', 'hash2']);
  });

  it('merges ATProto results and deduplicates by atprotoUri', async () => {
    reviewRows = [
      {
        id: 'at://did:plc:user/io.polaris.place.review/rec1',
        poi_uuid: 'place1',
        author_pubkey: 'did:plc:user',
        rating: 5,
        text: 'Great!',
        signature: '',
        created_at: 1700000100,
        updated_at: 1700000100,
        source: 'atproto',
        atproto_uri: 'at://did:plc:user/io.polaris.place.review/rec1',
        author_handle: 'alice.bsky.social',
      },
    ];

    const atprotoReviews: Review[] = [
      {
        id: 'at://did:plc:user/io.polaris.place.review/rec1',
        poiUuid: 'place1',
        authorPubkey: 'did:plc:user',
        authorHandle: 'alice.bsky.social',
        rating: 5,
        text: 'Great!',
        signature: '',
        createdAt: 1700000100,
        updatedAt: 1700000100,
        source: 'atproto',
        atprotoUri: 'at://did:plc:user/io.polaris.place.review/rec1',
      },
      {
        id: 'at://did:plc:user/io.polaris.place.review/rec2',
        poiUuid: 'place1',
        authorPubkey: 'did:plc:user',
        authorHandle: 'alice.bsky.social',
        rating: 3,
        text: 'New remote review',
        signature: '',
        createdAt: 1700000200,
        updatedAt: 1700000200,
        source: 'atproto',
        atprotoUri: 'at://did:plc:user/io.polaris.place.review/rec2',
      },
    ];
    mockFetchReviewsFromAtproto.mockResolvedValue(atprotoReviews);

    const result = await getReviewsForPlace('place1');

    // rec1 is already local (dedup), rec2 is new → total 2
    expect(result).toHaveLength(2);
    // Sorted by createdAt DESC
    expect(result[0].createdAt).toBe(1700000200);
    expect(result[1].createdAt).toBe(1700000100);
  });
});

describe('getReviewMedia', () => {
  it('maps media rows into ReviewMedia metadata', async () => {
    mediaRows = [mediaRow('r1', 'hash1', 'published')];

    const media = await getReviewMedia('r1');

    expect(media).toEqual<ReviewMedia[]>([
      {
        hash: 'hash1',
        width: 1600,
        height: 800,
        mime: 'image/jpeg',
        status: 'published',
        createdAt: 1700000000,
      },
    ]);
  });
});

describe('createOrUpdateReview', () => {
  it('uses Nostr keypair with source anonymous when no session', async () => {
    const review = await createOrUpdateReview('place1', 4, 'Good spot');

    expect(review.source).toBe('anonymous');
    expect(review.authorPubkey).toBe('a'.repeat(64));
    expect(review.signature).not.toBe('');
    expect(mockPublishReviewToAtproto).not.toHaveBeenCalled();
  });

  it('uses DID and calls publishReviewToAtproto when session exists', async () => {
    mockGetBlueskySession.mockResolvedValue({
      did: 'did:plc:testuser',
      handle: 'alice.bsky.social',
      accessJwt: 'jwt',
      refreshJwt: 'jwt',
    });
    mockPublishReviewToAtproto.mockResolvedValue(
      'at://did:plc:testuser/io.polaris.place.review/new1',
    );

    const review = await createOrUpdateReview('place1', 5, 'Amazing!');

    expect(review.source).toBe('atproto');
    expect(review.authorPubkey).toBe('did:plc:testuser');
    expect(review.signature).toBe('');
    expect(review.atprotoUri).toBe('at://did:plc:testuser/io.polaris.place.review/new1');
    expect(mockPublishReviewToAtproto).toHaveBeenCalled();
  });

  it('persists attached media and includes it in the Gun record', async () => {
    const media: ReviewMedia[] = [
      {
        hash: 'hash1',
        width: 1600,
        height: 800,
        mime: 'image/jpeg',
        status: 'local',
        createdAt: 1700000000,
      },
    ];

    const review = await createOrUpdateReview('place1', 4, 'Good spot', undefined, media);

    expect(review.media).toEqual(media);
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO review_media'),
      ['place1:' + 'a'.repeat(64), 'hash1', 1600, 800, 'image/jpeg', 'local', 1700000000],
    );
    expect(mockGunPut).toHaveBeenCalledWith(expect.objectContaining({ media }));
  });

  it('validates rating is integer 1-5', async () => {
    await expect(createOrUpdateReview('place1', 0)).rejects.toThrow(
      'Rating must be an integer between 1 and 5',
    );
    await expect(createOrUpdateReview('place1', 6)).rejects.toThrow(
      'Rating must be an integer between 1 and 5',
    );
    await expect(createOrUpdateReview('place1', 3.5)).rejects.toThrow(
      'Rating must be an integer between 1 and 5',
    );
  });

  it('continues on ATProto publish failure in Bluesky mode', async () => {
    mockGetBlueskySession.mockResolvedValue({
      did: 'did:plc:testuser',
      handle: 'alice.bsky.social',
      accessJwt: 'jwt',
      refreshJwt: 'jwt',
    });
    mockPublishReviewToAtproto.mockRejectedValue(new Error('Network error'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const review = await createOrUpdateReview('place1', 4);

    expect(review.source).toBe('atproto');
    expect(review.atprotoUri).toBeUndefined();
    warnSpy.mockRestore();
  });
});

describe('review media moderation', () => {
  beforeEach(() => {
    mediaRows = [mediaRow('place1:' + 'a'.repeat(64), 'hash1')];
  });

  it('reports a photo and tombstones its hash', async () => {
    await reportReviewMedia('place1:' + 'a'.repeat(64), 'hash1');

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE review_media SET status = ? WHERE review_id = ? AND hash = ?',
      ['reported', 'place1:' + 'a'.repeat(64), 'hash1'],
    );
    expect(mockTombstoneReviewMedia).toHaveBeenCalledWith('hash1');
  });

  it('hides a photo and tombstones its hash', async () => {
    await hideReviewMedia('place1:' + 'a'.repeat(64), 'hash1');

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE review_media SET status = ? WHERE review_id = ? AND hash = ?',
      ['hidden', 'place1:' + 'a'.repeat(64), 'hash1'],
    );
    expect(mockTombstoneReviewMedia).toHaveBeenCalledWith('hash1');
  });

  it('publishes a local photo through the media transport', async () => {
    mockPublishReviewMediaToPeers.mockResolvedValue(undefined as never);

    await publishReviewMedia('place1:' + 'a'.repeat(64), 'hash1');

    expect(mockPublishReviewMediaToPeers).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'hash1', status: 'local' }),
    );
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE review_media SET status = ? WHERE review_id = ? AND hash = ?',
      ['published', 'place1:' + 'a'.repeat(64), 'hash1'],
    );
  });
});

describe('deleteReview', () => {
  it('deletes anonymous review using Nostr keypair and cleans up media', async () => {
    mediaRows = [mediaRow('place1:' + 'a'.repeat(64), 'hash1')];

    await deleteReview('place1');

    expect(mockDeleteReviewFromAtproto).not.toHaveBeenCalled();
    expect(mockRemoveReviewMediaFiles).toHaveBeenCalledWith('hash1');
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM review_media'),
      ['place1:' + 'a'.repeat(64)],
    );
  });

  it('deletes ATProto review when session exists', async () => {
    mockGetBlueskySession.mockResolvedValue({
      did: 'did:plc:testuser',
      handle: 'alice.bsky.social',
      accessJwt: 'jwt',
      refreshJwt: 'jwt',
    });
    reviewRows = [
      {
        id: 'at://did:plc:testuser/io.polaris.place.review/rec1',
        atproto_uri: 'at://did:plc:testuser/io.polaris.place.review/rec1',
      },
    ];
    mockDeleteReviewFromAtproto.mockResolvedValue(undefined);

    await deleteReview('place1');

    expect(mockDeleteReviewFromAtproto).toHaveBeenCalledWith(
      'at://did:plc:testuser/io.polaris.place.review/rec1',
    );
  });
});
