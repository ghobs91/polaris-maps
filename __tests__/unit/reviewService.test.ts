/**
 * Tests for reviewService.ts — dual-backend review system with merged reads.
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

import {
  getReviewsForPlace,
  createOrUpdateReview,
  deleteReview,
} from '../../src/services/poi/reviewService';
import { getBlueskySession } from '../../src/services/atproto/atprotoAuthService';
import {
  publishReviewToAtproto,
  fetchReviewsFromAtproto,
  deleteReviewFromAtproto,
} from '../../src/services/atproto/atprotoReviewService';
import type { Review } from '../../src/models/review';

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

// Extract mock db from the jest.mock factory
const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: { getAllAsync: jest.Mock; getFirstAsync: jest.Mock; runAsync: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBlueskySession.mockResolvedValue(null);
  mockFetchReviewsFromAtproto.mockResolvedValue([]);
  mockDb.getAllAsync.mockResolvedValue([]);
  mockDb.getFirstAsync.mockResolvedValue(null);
  mockDb.runAsync.mockResolvedValue(undefined);
});

describe('getReviewsForPlace', () => {
  it('returns local reviews only when no session', async () => {
    const localRows = [
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
    mockDb.getAllAsync.mockResolvedValue(localRows);
    mockFetchReviewsFromAtproto.mockResolvedValue([]);

    const result = await getReviewsForPlace('place1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('place1:pubkey1');
    expect(result[0].source).toBe('anonymous');
  });

  it('merges ATProto results and deduplicates by atprotoUri', async () => {
    const localRows = [
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
    mockDb.getAllAsync.mockResolvedValue(localRows);

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

describe('createOrUpdateReview', () => {
  it('uses Nostr keypair with source anonymous when no session', async () => {
    mockGetBlueskySession.mockResolvedValue(null);

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

describe('deleteReview', () => {
  it('deletes anonymous review using Nostr keypair', async () => {
    mockGetBlueskySession.mockResolvedValue(null);

    await deleteReview('place1');

    expect(mockDeleteReviewFromAtproto).not.toHaveBeenCalled();
    expect(mockDb.runAsync).toHaveBeenCalled();
  });

  it('deletes ATProto review when session exists', async () => {
    mockGetBlueskySession.mockResolvedValue({
      did: 'did:plc:testuser',
      handle: 'alice.bsky.social',
      accessJwt: 'jwt',
      refreshJwt: 'jwt',
    });
    mockDb.getFirstAsync.mockResolvedValue({
      atproto_uri: 'at://did:plc:testuser/io.polaris.place.review/rec1',
    });
    mockDeleteReviewFromAtproto.mockResolvedValue(undefined);

    await deleteReview('place1');

    expect(mockDeleteReviewFromAtproto).toHaveBeenCalledWith(
      'at://did:plc:testuser/io.polaris.place.review/rec1',
    );
  });
});
