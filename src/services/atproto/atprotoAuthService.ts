import { BskyAgent } from '@atproto/api';
import { ExpoOAuthClient } from '@atproto/oauth-client-expo';
import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Persisted state (DID only; tokens are managed by the OAuth client via MMKV)
// ---------------------------------------------------------------------------

const DID_KEY = 'atproto_did';

// ---------------------------------------------------------------------------
// Client metadata
//
// This metadata MUST also be served at the client_id URL so the PDS can
// verify the client during the OAuth flow:
//   https://polarismaps.com/.well-known/oauth-client-metadata.json
// ---------------------------------------------------------------------------

const CLIENT_METADATA = {
  client_id: 'https://polaris-maps-bsky-auth.netlify.app/.well-known/oauth-client-metadata.json',
  client_name: 'Polaris Maps',
  client_uri: 'https://polarismaps.com',
  redirect_uris: ['polaris-maps:/oauth/callback'],
  scope: 'atproto transition:generic',
  token_endpoint_auth_method: 'none',
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  application_type: 'native',
  dpop_bound_access_tokens: true,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AtprotoSession {
  did: string;
  handle: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

let oauthClient: ExpoOAuthClient | null = null;
let agent: BskyAgent | null = null;

/** Lazily create (or return) the shared OAuth client instance. */
function getClient(): ExpoOAuthClient {
  if (!oauthClient) {
    oauthClient = new ExpoOAuthClient({
      handleResolver: 'https://bsky.social',
      clientMetadata: CLIENT_METADATA,
    });
  }
  return oauthClient;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return the current Bluesky agent (or null if not logged in). */
export function getAgent(): BskyAgent | null {
  return agent;
}

/**
 * Initiate the Bluesky OAuth login flow.
 *
 * Opens the system browser so the user can authorise the app on their PDS.
 * Returns the resulting session (did + handle) on success.
 */
export async function loginWithBluesky(handle: string): Promise<AtprotoSession> {
  const client = getClient();

  try {
    console.log('[bsky-oauth] Starting signIn for:', handle);
    const result = await client.signIn(handle);
    console.log('[bsky-oauth] signIn result:', JSON.stringify(result));

    if (result.status !== 'success' || !result.session) {
      throw new AuthError(
        `Login was cancelled or failed (status: ${(result as { status?: string }).status})`,
      );
    }

    agent = new BskyAgent(result.session);

    const { did, handle: resolvedHandle } = agent.session ?? {};
    if (!did) {
      throw new AuthError('No DID in session after login');
    }

    const session: AtprotoSession = {
      did,
      handle: resolvedHandle ?? handle,
    };

    await SecureStore.setItemAsync(DID_KEY, session.did);
    console.log('[bsky-oauth] Login successful:', session);

    return session;
  } catch (err) {
    const message =
      err instanceof AuthError
        ? err.message
        : `Login failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error('[bsky-oauth]', message);
    if (err instanceof AuthError) throw err;
    throw new AuthError(message, err);
  }
}

/** Log out and discard all stored tokens. */
export async function logoutBluesky(): Promise<void> {
  await SecureStore.deleteItemAsync(DID_KEY);
  agent = null;
  oauthClient = null;
}

/**
 * Return the current session info (did + handle) if the user is logged in.
 *
 * Prefer this over reading SecureStore directly — it also validates that the
 * in-memory agent has a live session.
 */
export async function getBlueskySession(): Promise<AtprotoSession | null> {
  if (!agent?.session?.did) return null;

  return {
    did: agent.session.did,
    handle: (agent.session as { handle?: string }).handle ?? '',
  };
}

/**
 * Restore a previous OAuth session from MMKV (keyed by the persisted DID).
 *
 * Called on app start and whenever the session needs to be re-established
 * after the agent has been garbage-collected.
 */
export async function restoreBlueskySession(): Promise<AtprotoSession | null> {
  const did = await SecureStore.getItemAsync(DID_KEY);
  if (!did) return null;

  try {
    const client = getClient();
    const oauthSession = await client.restore(did);

    agent = new BskyAgent(oauthSession);

    const sessionDid = agent.session?.did;
    const sessionHandle = (agent.session as { handle?: string }).handle ?? '';

    return {
      did: sessionDid ?? did,
      handle: sessionHandle,
    };
  } catch (err) {
    // Session is invalid or expired — clear everything
    await logoutBluesky();
    throw new AuthError('Session restore failed', err);
  }
}
