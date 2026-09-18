/**
 * Tests for the background reviews import queue.
 * Resolver, Bluesky session, and review writer are mocked; pacing is set to
 * ~0 so the sequential loop runs fast while still exercising ordering.
 */

jest.mock('../../src/services/atproto/atprotoAuthService', () => ({
  getBlueskySession: jest.fn(),
}));

jest.mock('../../src/services/poi/reviewService', () => ({
  createOrUpdateReview: jest.fn(),
}));

jest.mock('../../src/services/reviews/reviewPlaceResolver', () => ({
  resolvePlaceForReview: jest.fn(),
}));

import { getBlueskySession } from '../../src/services/atproto/atprotoAuthService';
import { createOrUpdateReview } from '../../src/services/poi/reviewService';
import { resolvePlaceForReview } from '../../src/services/reviews/reviewPlaceResolver';
import {
  cancelReviewImport,
  startReviewImport,
} from '../../src/services/reviews/reviewImportQueue';
import type { ParsedGoogleReview } from '../../src/services/reviews/googleReviewsImport';

const mockSession = getBlueskySession as jest.Mock;
const mockCreate = createOrUpdateReview as jest.Mock;
const mockResolve = resolvePlaceForReview as jest.Mock;

function review(name: string): ParsedGoogleReview {
  return { name, lat: 40.7, lng: -73.6, rating: 5, text: 'Great' };
}

function resolved(uuid: string) {
  return {
    place: { uuid, source: 'osm', name: uuid, lat: 40.7, lng: -73.6 },
    context: { poiUuid: uuid, source: 'osm' as const },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  cancelReviewImport();
  mockSession.mockResolvedValue({ did: 'did:plc:test', handle: 'test.bsky.social' });
});

describe('startReviewImport', () => {
  it('refuses to run without a Bluesky session', async () => {
    mockSession.mockResolvedValue(null);
    await expect(startReviewImport([review('A')], { pacingMs: 0 })).rejects.toThrow(
      /Sign in to Bluesky/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('imports matched reviews one by one, preserving original timestamps', async () => {
    mockResolve.mockResolvedValueOnce(resolved('uuid-a')).mockResolvedValueOnce(resolved('uuid-b'));
    mockCreate.mockResolvedValue({});

    const progress = await startReviewImport(
      [{ ...review('A'), createdAt: 1700000000 }, review('B')],
      { pacingMs: 0 },
    );

    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(2);
    expect(progress.imported).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenNthCalledWith(
      1,
      'uuid-a',
      5,
      'Great',
      expect.objectContaining({ poiUuid: 'uuid-a' }),
      undefined,
      { createdAt: 1700000000 },
    );
    expect(mockCreate).toHaveBeenNthCalledWith(
      2,
      'uuid-b',
      5,
      'Great',
      expect.objectContaining({ poiUuid: 'uuid-b' }),
      undefined,
      undefined,
    );
  });

  it('skips unmatched places and keeps going after failures', async () => {
    mockResolve
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolved('uuid-b'))
      .mockResolvedValueOnce(resolved('uuid-c'));
    mockCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('rate limited'));

    const progress = await startReviewImport([review('Missing'), review('Ok'), review('Boom')], {
      pacingMs: 0,
    });

    expect(progress.imported).toBe(1);
    expect(progress.unmatched).toEqual(['Missing']);
    expect(progress.failed).toEqual(['Boom']);
    expect(progress.completed).toBe(3);
  });
});
