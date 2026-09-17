/**
 * Tests for the review photo attach pipeline and opt-in publication.
 */

const mockExistingFiles = new Set<string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn((uri: string) => Promise.resolve(`b64:${uri}`)),
  getInfoAsync: jest.fn((uri: string) =>
    Promise.resolve({ exists: mockExistingFiles.has(uri), uri }),
  ),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn((_algo: string, data: string) => Promise.resolve(`hash(${data})`)),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const mockPut = jest.fn();
jest.mock('../../src/services/gun/init', () => {
  const chain: Record<string, unknown> = {};
  chain.get = jest.fn(() => chain);
  chain.put = (...args: unknown[]) => mockPut(...args);
  return { getGun: jest.fn(() => chain) };
});

jest.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: { getState: jest.fn() },
}));

import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync } from 'expo-image-manipulator';
import { useSettingsStore } from '../../src/stores/settingsStore';
import {
  attachReviewPhoto,
  boundingResize,
  publishReviewMedia,
  removeReviewMediaFiles,
  resolveReviewMediaUri,
  reviewMediaFilePath,
  tombstoneReviewMedia,
  REVIEW_MEDIA_NAMESPACE,
} from '../../src/services/poi/reviewMediaService';
import type { ReviewMedia } from '../../src/models/review';

const manipulateMock = manipulateAsync as jest.MockedFunction<typeof manipulateAsync>;
const getInfoMock = FileSystem.getInfoAsync as jest.MockedFunction<typeof FileSystem.getInfoAsync>;
const moveMock = FileSystem.moveAsync as jest.MockedFunction<typeof FileSystem.moveAsync>;
const deleteMock = FileSystem.deleteAsync as jest.MockedFunction<typeof FileSystem.deleteAsync>;
const getStateMock = useSettingsStore.getState as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExistingFiles.clear();
  manipulateMock.mockImplementation(async (_uri, actions) => {
    if (!actions || actions.length === 0) return { uri: 'probe', width: 2000, height: 1000 };
    const resize = actions[0].resize!;
    if (resize.width === 1600) return { uri: 'full', width: 1600, height: 800 };
    return { uri: 'thumb', width: 320, height: 160 };
  });
});

describe('boundingResize', () => {
  it('bounds the longest edge for landscape and portrait images', () => {
    expect(boundingResize(2000, 1000, 1600)).toEqual({ resize: { width: 1600 } });
    expect(boundingResize(1000, 2000, 1600)).toEqual({ resize: { height: 1600 } });
  });

  it('returns null when the image already fits', () => {
    expect(boundingResize(1600, 1600, 1600)).toBeNull();
    expect(boundingResize(320, 200, 1600)).toBeNull();
  });

  it('rejects invalid dimensions', () => {
    expect(() => boundingResize(0, 100, 1600)).toThrow('Invalid image dimensions');
    expect(() => boundingResize(NaN, 100, 1600)).toThrow('Invalid image dimensions');
  });
});

describe('attachReviewPhoto', () => {
  it('downscales, thumbnails, hashes, and writes content-addressed files', async () => {
    const result = await attachReviewPhoto('file:///tmp/pick.jpg');

    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith('file:///docs/review-media/', {
      intermediates: true,
    });
    // probe + full + thumb
    expect(manipulateMock).toHaveBeenCalledTimes(3);

    // full hash is derived from the final full-size bytes
    const fullHash = 'hash(b64:full)';
    expect(moveMock).toHaveBeenCalledWith({
      from: 'full',
      to: reviewMediaFilePath(fullHash, 'full'),
    });
    expect(moveMock).toHaveBeenCalledWith({
      from: 'thumb',
      to: reviewMediaFilePath(fullHash, 'thumb'),
    });

    expect(result.media).toMatchObject({
      hash: fullHash,
      width: 1600,
      height: 800,
      mime: 'image/jpeg',
      status: 'local',
    });
    expect(result.uri).toBe(reviewMediaFilePath(fullHash, 'full'));
    expect(result.thumbUri).toBe(reviewMediaFilePath(fullHash, 'thumb'));
  });

  it('replaces an existing content-addressed file instead of overwriting it twice', async () => {
    const fullHash = 'hash(b64:full)';
    mockExistingFiles.add(reviewMediaFilePath(fullHash, 'full'));

    await attachReviewPhoto('file:///tmp/pick.jpg');

    expect(deleteMock).toHaveBeenCalledWith('full', { idempotent: true });
    // Only the thumbnail is moved; the full-size duplicate is discarded.
    expect(moveMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveReviewMediaUri', () => {
  it('returns the cached URI when present', async () => {
    const path = reviewMediaFilePath('abc', 'thumb');
    mockExistingFiles.add(path);
    getInfoMock.mockImplementation(async (uri: string) => ({
      exists: mockExistingFiles.has(uri),
      uri,
    }));

    await expect(resolveReviewMediaUri('abc', 'thumb')).resolves.toBe(path);
  });

  it('returns null for a local miss', async () => {
    await expect(resolveReviewMediaUri('missing')).resolves.toBeNull();
  });
});

describe('removeReviewMediaFiles', () => {
  it('deletes the full-size and thumbnail files idempotently', async () => {
    await removeReviewMediaFiles('abc');
    expect(deleteMock).toHaveBeenCalledWith(reviewMediaFilePath('abc', 'full'), {
      idempotent: true,
    });
    expect(deleteMock).toHaveBeenCalledWith(reviewMediaFilePath('abc', 'thumb'), {
      idempotent: true,
    });
  });
});

describe('publishReviewMedia', () => {
  const localMedia: ReviewMedia = {
    hash: 'abc',
    width: 1600,
    height: 800,
    mime: 'image/jpeg',
    status: 'local',
    createdAt: 123,
  };

  it('refuses to publish when photo sharing is disabled', async () => {
    getStateMock.mockReturnValue({ permissions: { reviewPhotoSharingEnabled: false } });

    await expect(publishReviewMedia(localMedia)).rejects.toThrow(/disabled/i);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('writes content-addressed metadata and returns a published status', async () => {
    getStateMock.mockReturnValue({ permissions: { reviewPhotoSharingEnabled: true } });

    const published = await publishReviewMedia(localMedia);

    expect(published.status).toBe('published');
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'abc', deleted: false, mime: 'image/jpeg' }),
    );
    expect(REVIEW_MEDIA_NAMESPACE).toBe('review_media');
  });

  it('never re-publishes reported media', async () => {
    getStateMock.mockReturnValue({ permissions: { reviewPhotoSharingEnabled: true } });

    await expect(publishReviewMedia({ ...localMedia, status: 'reported' })).rejects.toThrow(
      /Cannot publish/,
    );
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('tombstoneReviewMedia', () => {
  it('writes a deletion tombstone for a hash', () => {
    tombstoneReviewMedia('abc');
    expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({ hash: 'abc', deleted: true }));
  });
});
