/**
 * Tests for atprotoAuthService.ts — ATProto/Bluesky authentication.
 */

// Mock expo-secure-store
const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore[key] ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
}));

// Mock BskyAgent
const mockLogin = jest.fn();
const mockResumeSession = jest.fn();
let mockSession: Record<string, string> | null = null;

jest.mock('@atproto/api', () => ({
  BskyAgent: jest.fn().mockImplementation(() => ({
    login: mockLogin,
    resumeSession: mockResumeSession,
    get session() {
      return mockSession;
    },
    api: {},
  })),
}));

import {
  loginWithBluesky,
  logoutBluesky,
  getBlueskySession,
  refreshBlueskySession,
  getAgent,
  AuthError,
} from '../../src/services/atproto/atprotoAuthService';

beforeEach(() => {
  // Clear secure store
  for (const key of Object.keys(mockSecureStore)) {
    delete mockSecureStore[key];
  }
  mockLogin.mockReset();
  mockResumeSession.mockReset();
  mockSession = null;
});

describe('loginWithBluesky', () => {
  it('stores session in SecureStore and sets agent on success', async () => {
    mockLogin.mockResolvedValue({ success: true });
    mockSession = {
      did: 'did:plc:test123',
      handle: 'alice.bsky.social',
      accessJwt: 'access-jwt',
      refreshJwt: 'refresh-jwt',
    };

    await loginWithBluesky('alice.bsky.social', 'app-password-123');

    expect(mockLogin).toHaveBeenCalledWith({
      identifier: 'alice.bsky.social',
      password: 'app-password-123',
    });

    const stored = JSON.parse(mockSecureStore['atproto_session']);
    expect(stored.did).toBe('did:plc:test123');
    expect(stored.handle).toBe('alice.bsky.social');
    expect(getAgent()).not.toBeNull();
  });

  it('throws AuthError on login failure', async () => {
    mockLogin.mockResolvedValue({ success: false });

    await expect(loginWithBluesky('bad', 'bad')).rejects.toThrow(AuthError);
  });

  it('throws AuthError when agent.login throws', async () => {
    mockLogin.mockRejectedValue(new Error('Network error'));

    await expect(loginWithBluesky('bad', 'bad')).rejects.toThrow(AuthError);
  });
});

describe('logoutBluesky', () => {
  it('deletes SecureStore key and sets agent to null', async () => {
    // Setup: simulate logged in state
    mockSecureStore['atproto_session'] = JSON.stringify({
      did: 'did:plc:test123',
      handle: 'alice.bsky.social',
      accessJwt: 'a',
      refreshJwt: 'r',
    });

    await logoutBluesky();

    expect(mockSecureStore['atproto_session']).toBeUndefined();
    expect(getAgent()).toBeNull();
  });
});

describe('getBlueskySession', () => {
  it('returns null when SecureStore is empty', async () => {
    const result = await getBlueskySession();
    expect(result).toBeNull();
  });

  it('returns parsed session when valid data exists', async () => {
    const session = {
      did: 'did:plc:test123',
      handle: 'alice.bsky.social',
      accessJwt: 'a',
      refreshJwt: 'r',
    };
    mockSecureStore['atproto_session'] = JSON.stringify(session);

    const result = await getBlueskySession();
    expect(result).toEqual(session);
  });

  it('returns null for corrupt JSON', async () => {
    mockSecureStore['atproto_session'] = 'not-json';

    const result = await getBlueskySession();
    expect(result).toBeNull();
  });
});

describe('refreshBlueskySession', () => {
  it('calls agent.resumeSession and re-persists', async () => {
    const session = {
      did: 'did:plc:test123',
      handle: 'alice.bsky.social',
      accessJwt: 'old-access',
      refreshJwt: 'old-refresh',
    };
    mockSecureStore['atproto_session'] = JSON.stringify(session);
    mockResumeSession.mockResolvedValue(undefined);
    mockSession = {
      did: 'did:plc:test123',
      handle: 'alice.bsky.social',
      accessJwt: 'new-access',
      refreshJwt: 'new-refresh',
    };

    await refreshBlueskySession();

    expect(mockResumeSession).toHaveBeenCalled();
    const updated = JSON.parse(mockSecureStore['atproto_session']);
    expect(updated.accessJwt).toBe('new-access');
    expect(getAgent()).not.toBeNull();
  });

  it('clears session on resumeSession failure', async () => {
    mockSecureStore['atproto_session'] = JSON.stringify({
      did: 'did:plc:test123',
      handle: 'alice.bsky.social',
      accessJwt: 'a',
      refreshJwt: 'r',
    });
    mockResumeSession.mockRejectedValue(new Error('expired'));

    await expect(refreshBlueskySession()).rejects.toThrow(AuthError);
    expect(mockSecureStore['atproto_session']).toBeUndefined();
  });
});
