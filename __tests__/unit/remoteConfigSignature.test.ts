import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schnorr } from '@noble/curves/secp256k1';
import { DEFAULT_REMOTE_FLAGS, parseRemoteConfig } from '../../src/services/config/remoteConfig';

const PRIVATE_KEY_HEX = '11'.repeat(32);
const PUBLIC_KEY_HEX = Buffer.from(
  schnorr.getPublicKey(Uint8Array.from(Buffer.from(PRIVATE_KEY_HEX, 'hex'))),
).toString('hex');

describe('sign-remote-config script', () => {
  it('emits a document the app verifies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polaris-config-'));
    const inputPath = join(dir, 'config.json');
    writeFileSync(
      inputPath,
      JSON.stringify({
        version: 3,
        issuedAt: '2026-11-09T00:00:00.000Z',
        flags: { streetView: false },
      }),
    );

    const output = execFileSync(process.execPath, ['scripts/sign-remote-config.mjs', inputPath], {
      env: { ...process.env, POLARIS_CONFIG_PRIVATE_KEY: PRIVATE_KEY_HEX },
      encoding: 'utf8',
    });

    expect(parseRemoteConfig(JSON.parse(output), [PUBLIC_KEY_HEX])).toEqual({
      ...DEFAULT_REMOTE_FLAGS,
      streetView: false,
    });
  });
});
