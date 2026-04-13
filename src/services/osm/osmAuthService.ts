/**
 * OSM OAuth 2.0 authentication service (Authorization Code + PKCE).
 *
 * Uses expo-web-browser to open the OSM authorize page and expo-crypto
 * for the PKCE code verifier / challenge.  Tokens are stored via the
 * osmAuthStore (which persists them in expo-secure-store).
 */
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OSM_BASE = 'https://www.openstreetmap.org';
const OSM_API = 'https://api.openstreetmap.org';

/**
 * Register your OAuth2 app at https://www.openstreetmap.org/oauth2/applications/new
 *
 * - Redirect URI must match the `scheme` in app.json (`polaris-maps://`)
 * - NOT a confidential application (mobile app — no client secret needed)
 * - Scopes: read_prefs write_api
 */
const CLIENT_ID = 'RS0WOqFZMVPwo9zfHft0ir2MNRZXmy3vQTeHBSTubxU';
const REDIRECT_URI = Linking.createURL('osm-auth');
const SCOPES = 'read_prefs write_api';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    result += chars[(b0 >> 2) & 0x3f];
    result += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
    result += i + 1 < bytes.length ? chars[((b1 << 2) | (b2 >> 6)) & 0x3f] : '=';
    result += i + 2 < bytes.length ? chars[b2 & 0x3f] : '=';
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a random 43-character code verifier. */
export async function generateCodeVerifier(): Promise<string> {
  // Build a random string from randomUUID (no getRandomBytesAsync in our types)
  const raw = Crypto.randomUUID() + Crypto.randomUUID();
  const bytes = new TextEncoder().encode(raw);
  return base64UrlEncode(bytes).slice(0, 43);
}

/** Derive the S256 code challenge from a verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  // digestStringAsync returns hex by default — convert to base64url
  const bytes = new Uint8Array((digest.match(/.{2}/g) ?? []).map((h: string) => parseInt(h, 16)));
  return base64UrlEncode(bytes);
}

// ---------------------------------------------------------------------------
// OAuth2 flow
// ---------------------------------------------------------------------------

export interface OsmAuthResult {
  accessToken: string;
  scope: string;
  createdAt: number;
}

/**
 * Open the OSM authorize page in the system browser, wait for the redirect
 * with the authorization code, then exchange it for an access token.
 */
export async function loginWithOsm(): Promise<OsmAuthResult> {
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = await generateCodeVerifier(); // random state param

  const authUrl =
    `${OSM_BASE}/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256` +
    `&state=${encodeURIComponent(state)}`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);

  if (result.type !== 'success' || !result.url) {
    throw new Error('OSM login was cancelled or failed');
  }

  const params = new URL(result.url).searchParams ?? parseQuery(result.url);
  const code = params.get('code');
  const returnedState = params.get('state');

  if (!code) {
    throw new Error('No authorization code received from OSM');
  }
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  // Exchange code for access token
  const tokenResp = await fetch(`${OSM_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: [
      `grant_type=authorization_code`,
      `code=${encodeURIComponent(code)}`,
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      `client_id=${encodeURIComponent(CLIENT_ID)}`,
      `code_verifier=${encodeURIComponent(verifier)}`,
    ].join('&'),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`Token exchange failed (${tokenResp.status}): ${text}`);
  }

  const json = (await tokenResp.json()) as {
    access_token: string;
    token_type: string;
    scope: string;
    created_at: number;
  };

  return {
    accessToken: json.access_token,
    scope: json.scope,
    createdAt: json.created_at,
  };
}

// ---------------------------------------------------------------------------
// User details
// ---------------------------------------------------------------------------

export interface OsmUser {
  id: number;
  displayName: string;
  avatarUrl?: string;
}

/** Fetch the authenticated user's profile. */
export async function fetchOsmUserDetails(accessToken: string): Promise<OsmUser> {
  const resp = await fetch(`${OSM_API}/api/0.6/user/details.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch OSM user details (${resp.status})`);
  }
  const json = (await resp.json()) as {
    user: { id: number; display_name: string; img?: { href: string } };
  };
  return {
    id: json.user.id,
    displayName: json.user.display_name,
    avatarUrl: json.user.img?.href,
  };
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

/** Quick check that the stored token still has write_api permission. */
export async function validateToken(accessToken: string): Promise<boolean> {
  try {
    const resp = await fetch(`${OSM_API}/api/0.6/permissions.json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return false;
    const json = (await resp.json()) as { permissions: string[] };
    return json.permissions.includes('allow_write_api');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Fallback URL query parser for environments without full URL support. */
function parseQuery(url: string): Map<string, string> {
  const map = new Map<string, string>();
  const qIdx = url.indexOf('?');
  if (qIdx < 0) return map;
  const qs = url.slice(qIdx + 1);
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    if (k) map.set(decodeURIComponent(k), decodeURIComponent(v ?? ''));
  }
  return map;
}
