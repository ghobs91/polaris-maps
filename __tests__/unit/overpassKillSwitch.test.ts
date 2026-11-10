/**
 * Overpass kill switch end to end.
 *
 * The remote-config flag only matters if applying it actually changes the
 * client's behaviour, so this drives the real signature/parse/apply path and
 * asserts the Overpass client's state.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockStore = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    delete: (key: string) => mockStore.delete(key),
  })),
}));

import { schnorr } from '@noble/curves/secp256k1';

import {
  DEFAULT_REMOTE_FLAGS,
  applyRemoteFlags,
  parseRemoteConfig,
  remoteConfigPayload,
  type RemoteConfigFlags,
} from '../../src/services/config/remoteConfig';
import {
  isOverpassEnabled,
  overpassFetch,
  setOverpassEnabled,
} from '../../src/services/overpassClient';
import { sign } from '../../src/services/identity/signing';

const privateKey = schnorr.utils.randomPrivateKey();
const publicKey = Array.from(schnorr.getPublicKey(privateKey))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signedConfig(flags: Partial<RemoteConfigFlags>): Promise<unknown> {
  const merged: RemoteConfigFlags = { ...DEFAULT_REMOTE_FLAGS, ...flags };
  const core = {
    version: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    flags: merged,
    publisherPubkey: publicKey,
  };
  const signature = await sign(remoteConfigPayload(core), privateKey);
  return { ...core, signature };
}

beforeEach(() => {
  mockStore.clear();
  setOverpassEnabled(true);
});

describe('overpassQuery flag', () => {
  it('is enabled by default', () => {
    expect(DEFAULT_REMOTE_FLAGS.overpassQuery).toBe(true);
    expect(isOverpassEnabled()).toBe(true);
  });

  it('disables the fallback when a signed config turns it off', async () => {
    const doc = await signedConfig({ overpassQuery: false });
    const flags = parseRemoteConfig(doc, [publicKey]);

    expect(flags).not.toBeNull();
    expect(flags!.overpassQuery).toBe(false);

    applyRemoteFlags(flags!);
    expect(isOverpassEnabled()).toBe(false);

    // And the client actually refuses to make a request.
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    await expect(overpassFetch({ query: 'test', timeoutMs: 1_000 })).rejects.toThrow(/disabled/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves the fallback enabled when the config omits the flag', async () => {
    const doc = (await signedConfig({})) as Record<string, unknown>;
    // Simulate an older publisher that never knew about the flag.
    const flags = { ...(doc.flags as RemoteConfigFlags) };
    delete (flags as Partial<RemoteConfigFlags>).overpassQuery;
    const legacy = { ...doc, flags };
    legacy.signature = await sign(
      remoteConfigPayload({
        version: legacy.version as number,
        issuedAt: legacy.issuedAt as string,
        flags: { ...DEFAULT_REMOTE_FLAGS, ...flags },
        publisherPubkey: publicKey,
      }),
      privateKey,
    );

    const parsed = parseRemoteConfig(legacy, [publicKey]);
    expect(parsed).not.toBeNull();
    applyRemoteFlags(parsed!);
    expect(isOverpassEnabled()).toBe(true);
  });

  it('ignores a config signed by an untrusted publisher', async () => {
    const doc = await signedConfig({ overpassQuery: false });
    expect(parseRemoteConfig(doc, ['f'.repeat(64)])).toBeNull();
  });

  it('rejects a config whose signed flags were edited after signing', async () => {
    const doc = (await signedConfig({ overpassQuery: false })) as {
      flags: RemoteConfigFlags;
    };
    doc.flags.trafficP2P = false; // a flag that IS in the signed payload
    expect(parseRemoteConfig(doc, [publicKey])).toBeNull();
  });

  it('accepts an edit to the unsigned kill-switch flag (documented tradeoff)', async () => {
    const doc = (await signedConfig({ overpassQuery: false })) as {
      flags: RemoteConfigFlags;
    };
    doc.flags.overpassQuery = true;

    // The flag is intentionally outside the signed payload so publishing a kill
    // switch does not invalidate configs already installed in the field. The
    // residual risk is bounded: its only effect is enabling/disabling an
    // optional third-party fallback that is enabled by default anyway.
    const parsed = parseRemoteConfig(doc, [publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.overpassQuery).toBe(true);
  });

  it('a local override still works without any config', () => {
    setOverpassEnabled(false);
    expect(isOverpassEnabled()).toBe(false);
    setOverpassEnabled(true);
    expect(isOverpassEnabled()).toBe(true);
  });
});

describe('signature payload', () => {
  it('does not cover the unsigned overpassQuery flag', () => {
    const base = {
      version: 1,
      issuedAt: '2026-01-01T00:00:00.000Z',
      flags: { ...DEFAULT_REMOTE_FLAGS },
      publisherPubkey: publicKey,
    };
    const withFlagOff = { ...base, flags: { ...base.flags, overpassQuery: false } };
    // Same signed bytes, so publishing a kill switch never invalidates configs
    // already installed in the field.
    expect(remoteConfigPayload(withFlagOff)).toBe(remoteConfigPayload(base));
  });

  it('produces 64-byte schnorr signatures', async () => {
    const signature = await sign('payload', privateKey);
    expect(signature).toHaveLength(128);
    expect(toHex(schnorr.sign(new Uint8Array(32), privateKey))).toHaveLength(128);
  });
});
