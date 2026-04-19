import { generateKeyPairSync } from 'node:crypto';

describe('buildMapkitJwt', () => {
  it('builds a three-part ES256 JWT', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const { buildMapkitJwt } = await import('../../scripts/generate-mapkit-token.mjs');

    const token = buildMapkitJwt({
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      now: 1_700_000_000,
      ttlDays: 30,
    });

    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.length > 0)).toBe(true);
  });

  it('throws when required inputs are missing', async () => {
    const { buildMapkitJwt } = await import('../../scripts/generate-mapkit-token.mjs');

    expect(() => buildMapkitJwt({ teamId: '', keyId: 'KEY', privateKeyPem: 'pem' })).toThrow(
      'APPLE_TEAM_ID is required',
    );
    expect(() => buildMapkitJwt({ teamId: 'TEAM', keyId: '', privateKeyPem: 'pem' })).toThrow(
      'APPLE_KEY_ID is required',
    );
  });
});
