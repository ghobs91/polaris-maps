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

// Mock ExpoOAuthClient
const mockSignIn = jest.fn();
const mockRestore = jest.fn();

jest.mock('@atproto/oauth-client-expo', () => ({
  ExpoOAuthClient: jest.fn().mockImplementation(() => ({
    signIn: mockSignIn,
    restore: mockRestore,
  })),
}));

// Mock BskyAgent
let mockAgentSession: { did: string; handle: string } | null = null;

jest.mock('@atproto/api', () => ({
  BskyAgent: jest.fn().mockImplementation(() => ({
    get session() {
      return mockAgentSession;
    },
    api: {},
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
  mockAgentSession = null;
});

describe('loginWithBluesky', () => {
  it('stores DID in SecureStore and sets agent on success', async () => {
    const oauthSession = { did: 'did:plc:test123' };
    mockSignIn.mockResolvedValue({ status: 'success', session: oauthSession });
    mockAgentSession = { did: 'did:plc:test123', handle: 'alice.bsky.social' };

    await loginWithBluesky('alice.bsky.social');

    expect(mockSignIn).toHaveBeenCalledWith('alice.bsky.social');

    const storedDid = mockSecureStore['atproto_did'];
    expect(storedDid).toBe('did:plc:test123');
    expect(getAgent()).not.toBeNull();
  });

  it('throws AuthError when signIn returns non-success status', async () => {
    mockSignIn.mockResolvedValue({ status: 'cancel' });

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

  it('returns session from in-memory agent', async () => {
    // Simulate login that sets the agent
    mockSignIn.mockResolvedValue({ status: 'success', session: { did: 'did:plc:test123' } });
    mockAgentSession = { did: 'did:plc:test123', handle: 'alice.bsky.social' };
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
    const oauthSession = { did: 'did:plc:test123' };
    mockRestore.mockResolvedValue(oauthSession);
    mockAgentSession = { did: 'did:plc:test123', handle: 'alice.bsky.social' };

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
