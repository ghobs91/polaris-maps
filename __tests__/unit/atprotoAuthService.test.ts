/**
 * Tests for atprotoAuthService.ts — ATProto/Bluesky OAuth authentication.
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

// Mock ExpoOAuthClient. On native, signIn/restore resolve directly to an
// OAuthSession (there is no { status, session } envelope).
const mockSignIn = jest.fn();
const mockRestore = jest.fn();

jest.mock('@atproto/oauth-client-expo', () => ({
  ExpoOAuthClient: jest.fn().mockImplementation(() => ({
    signIn: mockSignIn,
    restore: mockRestore,
  })),
}));

// Mock Agent. The DID comes from the OAuthSession the agent was built with,
// and the handle is resolved through com.atproto.server.getSession().
let mockAgentDid: string | null = null;
let mockHandle = 'alice.bsky.social';
const mockGetSession = jest.fn(() => Promise.resolve({ data: { handle: mockHandle } }));

jest.mock('@atproto/api', () => ({
  Agent: jest.fn().mockImplementation(() => ({
    get did() {
      return mockAgentDid;
    },
    get com() {
      return { atproto: { server: { getSession: mockGetSession } } };
    },
  })),
}));

import {
  loginWithBluesky,
  logoutBluesky,
  getBlueskySession,
  restoreBlueskySession,
  getAgent,
  AuthError,
} from '../../src/services/atproto/atprotoAuthService';

beforeEach(() => {
  // Clear secure store
  for (const key of Object.keys(mockSecureStore)) {
    delete mockSecureStore[key];
  }
  mockSignIn.mockReset();
  mockRestore.mockReset();
  mockGetSession.mockClear();
  mockAgentDid = null;
  mockHandle = 'alice.bsky.social';
});

describe('loginWithBluesky', () => {
  it('stores DID in SecureStore and sets agent on success', async () => {
    mockSignIn.mockResolvedValue({ did: 'did:plc:test123' });
    mockAgentDid = 'did:plc:test123';

    const session = await loginWithBluesky('alice.bsky.social');

    expect(mockSignIn).toHaveBeenCalledWith('alice.bsky.social');

    const storedDid = mockSecureStore['atproto_did'];
    expect(storedDid).toBe('did:plc:test123');
    expect(session).toEqual({ did: 'did:plc:test123', handle: 'alice.bsky.social' });
    expect(getAgent()).not.toBeNull();
  });

  it('falls back to the input handle when the PDS cannot resolve one', async () => {
    mockSignIn.mockResolvedValue({ did: 'did:plc:test123' });
    mockAgentDid = 'did:plc:test123';
    mockGetSession.mockRejectedValueOnce(new Error('offline'));

    const session = await loginWithBluesky('bob.test');

    expect(session).toEqual({ did: 'did:plc:test123', handle: 'bob.test' });
  });

  it('throws AuthError when the returned session has no DID', async () => {
    mockSignIn.mockResolvedValue({});
    mockAgentDid = null;

    await expect(loginWithBluesky('alice.bsky.social')).rejects.toThrow(AuthError);
  });

  it('throws AuthError when signIn throws', async () => {
    mockSignIn.mockRejectedValue(new Error('Network error'));

    await expect(loginWithBluesky('alice.bsky.social')).rejects.toThrow(AuthError);
  });
});

describe('logoutBluesky', () => {
  it('deletes SecureStore DID and sets agent to null', async () => {
    mockSecureStore['atproto_did'] = 'did:plc:test123';

    await logoutBluesky();

    expect(mockSecureStore['atproto_did']).toBeUndefined();
    expect(getAgent()).toBeNull();
  });
});

describe('getBlueskySession', () => {
  it('returns null when agent has no session', async () => {
    const result = await getBlueskySession();
    expect(result).toBeNull();
  });

  it('returns session from in-memory agent after login', async () => {
    mockSignIn.mockResolvedValue({ did: 'did:plc:test123' });
    mockAgentDid = 'did:plc:test123';
    await loginWithBluesky('alice.bsky.social');

    const result = await getBlueskySession();
    expect(result).toEqual({ did: 'did:plc:test123', handle: 'alice.bsky.social' });
  });
});

describe('restoreBlueskySession', () => {
  it('returns null when no DID is stored', async () => {
    const result = await restoreBlueskySession();
    expect(result).toBeNull();
  });

  it('restores session from stored DID and sets agent', async () => {
    mockSecureStore['atproto_did'] = 'did:plc:test123';
    mockRestore.mockResolvedValue({ did: 'did:plc:test123' });
    mockAgentDid = 'did:plc:test123';

    const result = await restoreBlueskySession();

    expect(mockRestore).toHaveBeenCalledWith('did:plc:test123');
    expect(result).toEqual({ did: 'did:plc:test123', handle: 'alice.bsky.social' });
    expect(getAgent()).not.toBeNull();
  });

  it('clears session and throws AuthError on restore failure', async () => {
    mockSecureStore['atproto_did'] = 'did:plc:test123';
    mockRestore.mockRejectedValue(new Error('expired'));

    await expect(restoreBlueskySession()).rejects.toThrow(AuthError);
    expect(mockSecureStore['atproto_did']).toBeUndefined();
    expect(getAgent()).toBeNull();
  });
});
