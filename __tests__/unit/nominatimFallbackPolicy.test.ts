/**
 * Nominatim fallback is opt-in.
 *
 * The flag only matters if it changes behaviour, so this drives the real
 * signature/parse/apply path and then asserts that `searchAddress` genuinely
 * stops reaching for the network.
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
  __resetNominatimPolicyForTests,
  isNominatimEnabled,
  setNominatimEnabled,
} from '../../src/services/geocoding/nominatimPolicy';
import { searchAddress } from '../../src/services/geocoding/geocodingService';
import { sign } from '../../src/services/identity/signing';

const privateKey = schnorr.utils.randomPrivateKey();
const publicKey = Array.from(schnorr.getPublicKey(privateKey))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

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
  __resetNominatimPolicyForTests();
});

describe('Nominatim is off by default', () => {
  it('ships disabled without an explicit opt-in', () => {
    expect(DEFAULT_REMOTE_FLAGS.nominatimFallback).toBe(false);
    expect(isNominatimEnabled()).toBe(false);
  });

  it('stays disabled when a signed config omits the flag', async () => {
    const parsed = parseRemoteConfig(await signedConfig({}), [publicKey]);
    expect(parsed).not.toBeNull();
    applyRemoteFlags(parsed!);
    expect(isNominatimEnabled()).toBe(false);
  });

  it('ignores a config signed by an untrusted publisher', async () => {
    const doc = await signedConfig({ nominatimFallback: true });
    expect(parseRemoteConfig(doc, ['f'.repeat(64)])).toBeNull();
  });
});

describe('remote config can enable it', () => {
  it('turns the fallback on when the unsigned flag is set', async () => {
    const parsed = parseRemoteConfig(await signedConfig({ nominatimFallback: true }), [publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.nominatimFallback).toBe(true);

    applyRemoteFlags(parsed!);
    expect(isNominatimEnabled()).toBe(true);
  });

  it('accepts an edit to the unsigned flag without invalidating the signature', async () => {
    const doc = (await signedConfig({ nominatimFallback: false })) as {
      flags: RemoteConfigFlags;
    };
    doc.flags.nominatimFallback = true;

    // Outside the signed payload on purpose (same tradeoff as overpassQuery):
    // publishing a flag must not invalidate configs already installed in the
    // field. The residual risk is bounded — the flag's only effect is enabling
    // an optional third-party fallback that ships disabled.
    const parsed = parseRemoteConfig(doc, [publicKey]);
    expect(parsed).not.toBeNull();
    expect(parsed!.nominatimFallback).toBe(true);
  });
});

describe('searchAddress respects the gate', () => {
  const fetchSpy = jest.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  it('never calls the network while disabled', async () => {
    await searchAddress('350 fifth avenue, new york', 5, 40.7484, -73.9857);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the network once enabled', async () => {
    setNominatimEnabled(true);
    await searchAddress('350 fifth avenue, new york', 5, 40.7484, -73.9857);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('nominatim.openstreetmap.org/search');
  });

  it('still honours localOnly', async () => {
    setNominatimEnabled(true);
    await searchAddress('350 fifth avenue, new york', 5, 40.7484, -73.9857, { localOnly: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
