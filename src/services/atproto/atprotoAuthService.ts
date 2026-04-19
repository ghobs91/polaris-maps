import { BskyAgent } from '@atproto/api';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'atproto_session';

export type AtprotoSession = {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

let agent: BskyAgent | null = null;

export function getAgent(): BskyAgent | null {
  return agent;
}

export async function loginWithBluesky(handle: string, appPassword: string): Promise<void> {
  const newAgent = new BskyAgent({ service: 'https://bsky.social' });
  try {
    const response = await newAgent.login({ identifier: handle, password: appPassword });
    if (!response.success) {
      throw new AuthError('Login failed');
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Login failed', err);
  }

  const session = newAgent.session;
  if (!session) {
    throw new AuthError('No session returned after login');
  }

  const storable: AtprotoSession = {
    did: session.did,
    handle: session.handle,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
  };

  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(storable));
  agent = newAgent;
}

export async function logoutBluesky(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  agent = null;
}

export async function getBlueskySession(): Promise<AtprotoSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'did' in parsed &&
      'handle' in parsed &&
      'accessJwt' in parsed &&
      'refreshJwt' in parsed
    ) {
      return parsed as AtprotoSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshBlueskySession(): Promise<void> {
  const stored = await getBlueskySession();
  if (!stored) return;

  const newAgent = new BskyAgent({ service: 'https://bsky.social' });
  try {
    await newAgent.resumeSession({
      did: stored.did,
      handle: stored.handle,
      accessJwt: stored.accessJwt,
      refreshJwt: stored.refreshJwt,
      active: true,
    });
  } catch (err) {
    // Session is invalid — clear it
    await logoutBluesky();
    throw new AuthError('Session refresh failed', err);
  }

  const session = newAgent.session;
  if (!session) {
    await logoutBluesky();
    return;
  }

  const updated: AtprotoSession = {
    did: session.did,
    handle: session.handle,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
  };

  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(updated));
  agent = newAgent;
}
