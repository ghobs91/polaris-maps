jest.mock('../../src/constants/regionPublishers', () => {
  // The same test key used below; kept inside the factory so Jest's hoisting
  // cannot reference a not-yet-initialised binding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { schnorr } = require('@noble/curves/secp256k1');
  const privateKey = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'));
  return {
    TRUSTED_REGION_PUBLISHERS: [Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex')],
  };
});

jest.mock('../../src/services/storage/mmkv', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
    },
    __store: store,
  };
});

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import { schnorr } from '@noble/curves/secp256k1';
import {
  DEFAULT_REMOTE_FLAGS,
  __resetRemoteConfigForTests,
  getRemoteFlags,
  initRemoteConfig,
  isFeatureEnabled,
  parseRemoteConfig,
  remoteConfigPayload,
  type RemoteConfig,
} from '../../src/services/config/remoteConfig';
import { sign } from '../../src/services/identity/signing';

const TEST_PRIVATE_KEY = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'));
const TEST_PUBLIC_KEY = Buffer.from(schnorr.getPublicKey(TEST_PRIVATE_KEY)).toString('hex');
const { __store: store } = jest.requireMock('../../src/services/storage/mmkv');

async function signedConfig(flags: Partial<typeof DEFAULT_REMOTE_FLAGS>): Promise<RemoteConfig> {
  const core = {
    version: 1,
    issuedAt: '2026-11-09T12:00:00.000Z',
    flags: { ...DEFAULT_REMOTE_FLAGS, ...flags },
    publisherPubkey: TEST_PUBLIC_KEY,
  };
  return { ...core, signature: await sign(remoteConfigPayload(core), TEST_PRIVATE_KEY) };
}

describe('remote config verification', () => {
  beforeEach(() => {
    __resetRemoteConfigForTests();
    store.clear();
    jest.restoreAllMocks();
  });

  it('accepts a signed config from a trusted publisher', async () => {
    const config = await signedConfig({ regionDownloads: false });
    expect(parseRemoteConfig(config, [TEST_PUBLIC_KEY])).toEqual({
      ...DEFAULT_REMOTE_FLAGS,
      regionDownloads: false,
    });
  });

  it('rejects an untrusted publisher', async () => {
    const config = await signedConfig({});
    expect(parseRemoteConfig(config, ['ab'.repeat(32)])).toBeNull();
  });

  it('rejects tampering with a flag after signing', async () => {
    const config = await signedConfig({ streetView: false });
    const tampered = { ...config, flags: { ...config.flags, streetView: true } };
    expect(parseRemoteConfig(tampered, [TEST_PUBLIC_KEY])).toBeNull();
  });

  it('rejects malformed documents', () => {
    expect(parseRemoteConfig(null, [TEST_PUBLIC_KEY])).toBeNull();
    expect(parseRemoteConfig({ version: 0 }, [TEST_PUBLIC_KEY])).toBeNull();
    expect(parseRemoteConfig({ version: 1, issuedAt: 'nope' }, [TEST_PUBLIC_KEY])).toBeNull();
  });

  it('defaults missing flags to enabled', async () => {
    const config = await signedConfig({});
    const withoutStreetView = { ...config, flags: { trafficP2P: true } };
    const resigned = {
      ...withoutStreetView,
      signature: await sign(
        remoteConfigPayload({
          version: 1,
          issuedAt: withoutStreetView.issuedAt,
          flags: { ...DEFAULT_REMOTE_FLAGS },
          publisherPubkey: TEST_PUBLIC_KEY,
        }),
        TEST_PRIVATE_KEY,
      ),
    };
    await expect(parseRemoteConfig(resigned, [TEST_PUBLIC_KEY])).toEqual(DEFAULT_REMOTE_FLAGS);
  });
});

describe('remote config lifecycle', () => {
  beforeEach(() => {
    __resetRemoteConfigForTests();
    store.clear();
    jest.restoreAllMocks();
  });

  it('applies and caches a verified config', async () => {
    const config = await signedConfig({ trafficP2P: false });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => config,
    }) as unknown as typeof fetch;

    await initRemoteConfig();

    expect(isFeatureEnabled('trafficP2P')).toBe(false);
    expect(isFeatureEnabled('streetView')).toBe(true);
    expect(store.get('remote_config:v1')).toContain('signature');
  });

  it('keeps safe defaults when the endpoint fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await initRemoteConfig();

    expect(getRemoteFlags()).toEqual(DEFAULT_REMOTE_FLAGS);
  });

  it('keeps safe defaults when the document is unsigned', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, issuedAt: '2026-11-09T12:00:00.000Z', flags: {} }),
    }) as unknown as typeof fetch;

    await initRemoteConfig();

    expect(getRemoteFlags()).toEqual(DEFAULT_REMOTE_FLAGS);
  });
});
