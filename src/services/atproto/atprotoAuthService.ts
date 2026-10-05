import { Agent } from '@atproto/api';
import { ExpoOAuthClient } from '@atproto/oauth-client-expo';
import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Persisted state (DID only; tokens are managed by the OAuth client via MMKV)
// ---------------------------------------------------------------------------

const DID_KEY = 'atproto_did';

// Passing a PDS host (rather than a user handle) to `signIn` opens Bluesky's
// own sign-in page, where the user can sign in with an existing account or
// create a new one. The app never has to collect a handle itself.
const BLUESKY_PDS = 'https://bsky.social';

// ---------------------------------------------------------------------------
// Client metadata
//
// This metadata MUST also be served at the client_id URL so the PDS can
// verify the client during the OAuth flow:
//   https://app.polarismaps.app/.well-known/oauth-client-metadata.json
//
// `client_uri` must share the client_id hostname, and the native redirect
// scheme must be the client_id hostname in reverse order, or the atproto server
// rejects the metadata (`invalid_client_metadata` / `invalid_redirect_uri`).
// `app.polarismaps.app` reverses to the scheme `app.polarismaps.app`, which is
// declared in app.json's `scheme` array (see Info.plist / AndroidManifest).
//
// The native redirect URI must use a custom scheme that passes
// `@atproto/oauth-client-expo`'s CUSTOM_URI_SCHEME_REGEX, which requires the
// scheme to contain at least one dot.
// ---------------------------------------------------------------------------

const CLIENT_METADATA = {
  client_id: 'https://app.polarismaps.app/.well-known/oauth-client-metadata.json',
  client_name: 'Polaris Maps',
  client_uri: 'https://app.polarismaps.app',
  redirect_uris: ['app.polarismaps.app:/oauth/callback'],
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
let agent: Agent | null = null;
let currentHandle = '';

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
export function getAgent(): Agent | null {
  return agent;
}

/**
 * Resolve the account handle for an authenticated agent.
 *
 * `OAuthSession` only exposes the DID, so the authoritative handle comes from
 * the PDS. Best-effort: an empty string means unknown.
 */
async function resolveHandle(oauthAgent: Agent): Promise<string> {
  try {
    const res = await oauthAgent.com.atproto.server.getSession();
    return res.data.handle ?? '';
  } catch {
    return '';
  }
}

/**
 * Initiate the Bluesky OAuth login flow.
 *
 * Opens Bluesky's own sign-in page in the system browser, so the user signs in
 * (or creates an account) there without the app asking for a handle. Returns
 * the resulting session (did + handle) on success.
 */
export async function loginWithBluesky(): Promise<AtprotoSession> {
  const client = getClient();

  try {
    console.log('[bsky-oauth] Starting signIn');
    // On native, `ExpoOAuthClient.signIn` resolves directly to an OAuthSession
    // (it opens the browser and handles the redirect internally).
    const oauthSession = await client.signIn(BLUESKY_PDS);
    const oauthAgent = new Agent(oauthSession);

    const did = oauthAgent.did;
    if (!did) {
      throw new AuthError('No DID in session after login');
    }

    const resolvedHandle = await resolveHandle(oauthAgent);
    agent = oauthAgent;
    currentHandle = resolvedHandle;

    await SecureStore.setItemAsync(DID_KEY, did);
    console.log('[bsky-oauth] Login successful:', { did, handle: resolvedHandle });

    return { did, handle: resolvedHandle };
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
  currentHandle = '';
  oauthClient = null;
}

/**
 * Return the current session info (did + handle) if the user is logged in.
 *
 * Prefer this over reading SecureStore directly — it also validates that the
 * in-memory agent has a live session.
 */
export async function getBlueskySession(): Promise<AtprotoSession | null> {
  const did = agent?.did;
  if (!did) return null;

  return { did, handle: currentHandle };
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
    const oauthAgent = new Agent(oauthSession);

    const resolvedHandle = await resolveHandle(oauthAgent);
    agent = oauthAgent;
    currentHandle = resolvedHandle;

    return {
      did: oauthAgent.did ?? did,
      handle: resolvedHandle,
    };
  } catch (err) {
    // Session is invalid or expired — clear everything
    await logoutBluesky();
    throw new AuthError('Session restore failed', err);
  }
}
