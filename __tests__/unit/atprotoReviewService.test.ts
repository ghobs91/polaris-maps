/**
 * Tests for atprotoReviewService.ts — ATProto review CRUD operations.
 */

// Mock secure store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock the agent and auth service
const mockCreateRecord = jest.fn();
const mockListRecords = jest.fn();
const mockDeleteRecord = jest.fn();

let mockAgentRef: { agent: ReturnType<typeof createMockAgent> | null } = { agent: null };
let mockSessionRef: {
  session: { did: string; handle: string; accessJwt: string; refreshJwt: string } | null;
} = { session: null };

function createMockAgent() {
  return {
    api: {
      com: {
        atproto: {
          repo: {
            createRecord: mockCreateRecord,
            listRecords: mockListRecords,
            deleteRecord: mockDeleteRecord,
          },
        },
      },
    },
  };
}

jest.mock('../../src/services/atproto/atprotoAuthService', () => ({
  getAgent: jest.fn(() => mockAgentRef.agent),
  getBlueskySession: jest.fn(() => Promise.resolve(mockSessionRef.session)),
  refreshBlueskySession: jest.fn().mockResolvedValue(undefined),
}));

import {
  publishReviewToAtproto,
  fetchReviewsFromAtproto,
  deleteReviewFromAtproto,
} from '../../src/services/atproto/atprotoReviewService';
import { refreshBlueskySession } from '../../src/services/atproto/atprotoAuthService';
import type { Review, PlaceReviewContext } from '../../src/models/review';

const TEST_SESSION = {
  did: 'did:plc:testuser',
  handle: 'alice.bsky.social',
  accessJwt: 'jwt-access',
  refreshJwt: 'jwt-refresh',
};

const TEST_REVIEW: Review = {
  id: 'test-place:did:plc:testuser',
  poiUuid: 'test-place',
  authorPubkey: 'did:plc:testuser',
  authorHandle: 'alice.bsky.social',
  rating: 4,
  text: 'Great place!',
  signature: '',
  createdAt: 1700000000,
  updatedAt: 1700000000,
  source: 'atproto',
};

const TEST_CONTEXT: PlaceReviewContext = {
  poiUuid: 'test-place',
  source: 'osm',
  osmId: 'node/12345',
  name: 'Test Café',
  lat: 42.36,
  lng: -71.06,
};

beforeEach(() => {
  mockCreateRecord.mockReset();
  mockListRecords.mockReset();
  mockDeleteRecord.mockReset();
  mockAgentRef.agent = null;
  mockSessionRef.session = null;
});

describe('publishReviewToAtproto', () => {
  it('creates record with correct collection and $type', async () => {
    mockAgentRef.agent = createMockAgent();
    mockSessionRef.session = TEST_SESSION;
    mockCreateRecord.mockResolvedValue({
      data: { uri: 'at://did:plc:testuser/io.polaris.place.review/abc123' },
    });

    const uri = await publishReviewToAtproto(TEST_REVIEW, TEST_CONTEXT);

    expect(uri).toBe('at://did:plc:testuser/io.polaris.place.review/abc123');
    expect(mockCreateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'did:plc:testuser',
        collection: 'io.polaris.place.review',
        record: expect.objectContaining({
          $type: 'io.polaris.place.review',
          rating: 4,
          text: 'Great place!',
          subject: expect.objectContaining({
            poiUuid: 'test-place',
            source: 'osm',
          }),
        }),
      }),
    );
  });

  it('throws when not logged in', async () => {
    mockAgentRef.agent = null;

    await expect(publishReviewToAtproto(TEST_REVIEW, TEST_CONTEXT)).rejects.toThrow(
      'Not logged in to Bluesky',
    );
  });

  it('retries on 401 after refreshing session', async () => {
    const agent = createMockAgent();
    mockAgentRef.agent = agent;
    mockSessionRef.session = TEST_SESSION;

    const error401 = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockCreateRecord.mockRejectedValueOnce(error401).mockResolvedValueOnce({
      data: { uri: 'at://did:plc:testuser/io.polaris.place.review/retry123' },
    });

    const uri = await publishReviewToAtproto(TEST_REVIEW, TEST_CONTEXT);

    expect(refreshBlueskySession).toHaveBeenCalled();
    expect(uri).toBe('at://did:plc:testuser/io.polaris.place.review/retry123');
  });
});

describe('fetchReviewsFromAtproto', () => {
  it('returns empty array when no session', async () => {
    mockAgentRef.agent = null;

    const result = await fetchReviewsFromAtproto('test-place');
    expect(result).toEqual([]);
  });

  it('maps records to Review[] with source atproto', async () => {
    mockAgentRef.agent = createMockAgent();
    mockSessionRef.session = TEST_SESSION;
    mockListRecords.mockResolvedValue({
      data: {
        records: [
          {
            uri: 'at://did:plc:testuser/io.polaris.place.review/rec1',
            value: {
              subject: { poiUuid: 'test-place' },
              rating: 5,
              text: 'Amazing!',
              createdAt: '2023-11-14T12:00:00.000Z',
            },
          },
          {
            uri: 'at://did:plc:testuser/io.polaris.place.review/rec2',
            value: {
              subject: { poiUuid: 'other-place' },
              rating: 3,
              createdAt: '2023-11-14T12:00:00.000Z',
            },
          },
        ],
      },
    });

    const result = await fetchReviewsFromAtproto('test-place');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('atproto');
    expect(result[0].poiUuid).toBe('test-place');
    expect(result[0].rating).toBe(5);
    expect(result[0].text).toBe('Amazing!');
    expect(result[0].authorPubkey).toBe('did:plc:testuser');
    expect(result[0].authorHandle).toBe('alice.bsky.social');
    expect(result[0].atprotoUri).toBe('at://did:plc:testuser/io.polaris.place.review/rec1');
  });

  it('returns empty array on error without throwing', async () => {
    mockAgentRef.agent = createMockAgent();
    mockSessionRef.session = TEST_SESSION;
    mockListRecords.mockRejectedValue(new Error('Network error'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchReviewsFromAtproto('test-place');
    expect(result).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe('deleteReviewFromAtproto', () => {
  it('parses rkey from at:// URI correctly', async () => {
    mockAgentRef.agent = createMockAgent();
    mockSessionRef.session = TEST_SESSION;
    mockDeleteRecord.mockResolvedValue({});

    await deleteReviewFromAtproto('at://did:plc:testuser/io.polaris.place.review/abc123');

    expect(mockDeleteRecord).toHaveBeenCalledWith({
      repo: 'did:plc:testuser',
      collection: 'io.polaris.place.review',
      rkey: 'abc123',
    });
  });

  it('throws when not logged in', async () => {
    mockAgentRef.agent = null;

    await expect(
      deleteReviewFromAtproto('at://did:plc:testuser/io.polaris.place.review/abc123'),
    ).rejects.toThrow('Not logged in to Bluesky');
  });
});
