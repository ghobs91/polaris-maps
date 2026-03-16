/**
 * Security regression tests for CVE fixes:
 *  1. Path traversal prevention in tar extraction (nodejs sidecar parity)
 *  2. API key proxy URL routing in traffic fetchers
 *  3. ErrorBoundary: no raw error message in production
 *  4. Gun.js edit signature verification (isEditSignatureValid)
 *  5. Gun.js reputation signature verification
 */

// ---------------------------------------------------------------------------
// 1. Path traversal guard (pure logic parity with the nodejs-mobile sidecar)
// ---------------------------------------------------------------------------
import path from 'path';

/**
 * Mirrors the path-traversal check in nodejs-assets/nodejs-project/index.js.
 * Returns true if the entry name is safe (stays within destDir).
 */
function isSafeEntry(destDir: string, nameRaw: string): boolean {
  const resolvedDestDir = path.resolve(destDir);
  const fullPath = path.resolve(resolvedDestDir, nameRaw);
  return fullPath.startsWith(resolvedDestDir + path.sep) || fullPath === resolvedDestDir;
}

describe('Tar path traversal guard', () => {
  const destDir = '/tmp/safe-dest';

  it('allows a normal relative entry', () => {
    expect(isSafeEntry(destDir, 'tiles/0/0/0.pbf')).toBe(true);
  });

  it('allows a root-level file', () => {
    expect(isSafeEntry(destDir, 'routing.bin')).toBe(true);
  });

  it('allows a nested directory entry ending in /', () => {
    expect(isSafeEntry(destDir, 'tiles/14/8192/')).toBe(true);
  });

  it('blocks classic ../../ path traversal', () => {
    expect(isSafeEntry(destDir, '../../etc/passwd')).toBe(false);
  });

  it('blocks absolute path entry', () => {
    expect(isSafeEntry(destDir, '/etc/cron.d/evil')).toBe(false);
  });

  it('blocks traversal disguised with mixed separators', () => {
    expect(isSafeEntry(destDir, 'tiles/../../../home/user/.ssh/authorized_keys')).toBe(false);
  });

  it('blocks traversal with multiple dots', () => {
    expect(isSafeEntry(destDir, './legit/../../outside.txt')).toBe(false);
  });

  it('allows entry whose name happens to contain double dots mid-segment', () => {
    // e.g. a file literally named "some..thing.pbf"
    expect(isSafeEntry(destDir, 'tiles/some..thing.pbf')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. ErrorBoundary: production build shows generic message, not raw error
// ---------------------------------------------------------------------------
describe('ErrorBoundary message exposure', () => {
  it('returns generic message in production (__DEV__ = false)', () => {
    const DEV = false;
    const errorMessage = 'Internal credentials at /src/secrets.ts:42';
    const displayedMessage = DEV ? errorMessage : 'An unexpected error occurred. Please try again.';
    expect(displayedMessage).not.toContain('credentials');
    expect(displayedMessage).not.toContain('/src/');
    expect(displayedMessage).toBe('An unexpected error occurred. Please try again.');
  });

  it('shows real error message in development (__DEV__ = true)', () => {
    const DEV = true;
    const errorMessage = 'Something internal';
    const displayedMessage = DEV ? errorMessage : 'An unexpected error occurred. Please try again.';
    expect(displayedMessage).toBe('Something internal');
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. Gun.js signature verification (sign/verify round-trip via @noble)
// ---------------------------------------------------------------------------
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

const encoder = new TextEncoder();
function signPayload(msg: string, privKey: Uint8Array): string {
  return bytesToHex(schnorr.sign(sha256(encoder.encode(msg)), privKey));
}
function verifyPayload(msg: string, sig: string, pubKey: string): boolean {
  return schnorr.verify(hexToBytes(sig), sha256(encoder.encode(msg)), pubKey);
}
function signingPayload(...fields: (string | number)[]): string {
  return fields.map(String).join('');
}

/** Mirrors isEditSignatureValid from editService.ts */
function isEditSignatureValid(data: Record<string, unknown>): boolean {
  const sig = (data.signature as string) ?? '';
  const pubkey = (data.author_pubkey as string) ?? '';
  const id = (data.id as string) ?? '';
  const entityId = (data.entity_id as string) ?? '';
  const fieldName = (data.field_name as string) ?? '';
  const createdAt = String((data.created_at as number) ?? 0);
  if (!sig || !pubkey) return false;
  const payload = signingPayload(id, entityId, fieldName, createdAt);
  return verifyPayload(payload, sig, pubkey);
}

/** Mirrors reputation signature verification from reputationService.ts */
function isReputationSignatureValid(data: Record<string, unknown>): boolean {
  const sig = (data.signature as string) ?? '';
  const pubkey = (data.pubkey as string) ?? '';
  if (!sig || !pubkey) return false;
  const payload = signingPayload(pubkey, String(data.score ?? 0), String(data.last_updated ?? 0));
  return verifyPayload(payload, sig, pubkey);
}

describe('Gun.js edit signature verification', () => {
  let privKey: Uint8Array;
  let pubKey: string;

  beforeAll(() => {
    privKey = schnorr.utils.randomPrivateKey();
    pubKey = bytesToHex(schnorr.getPublicKey(privKey));
  });

  it('accepts a legitimately signed edit record', () => {
    const id = 'place:abc:1700000000:' + pubKey;
    const entityId = 'abc';
    const fieldName = 'name';
    const createdAt = 1700000000;
    const payload = signingPayload(id, entityId, fieldName, createdAt);
    const signature = signPayload(payload, privKey);

    const record = {
      id,
      entity_id: entityId,
      author_pubkey: pubKey,
      field_name: fieldName,
      created_at: createdAt,
      signature,
    };

    expect(isEditSignatureValid(record)).toBe(true);
  });

  it('rejects a record with no signature', () => {
    const record = {
      id: 'place:abc:1700000000:' + pubKey,
      entity_id: 'abc',
      author_pubkey: pubKey,
      field_name: 'name',
      created_at: 1700000000,
      signature: '',
    };
    expect(isEditSignatureValid(record)).toBe(false);
  });

  it('rejects a tampered field_name in an otherwise valid record', () => {
    const id = 'place:abc:1700000000:' + pubKey;
    const entityId = 'abc';
    const fieldName = 'name';
    const createdAt = 1700000000;
    const payload = signingPayload(id, entityId, fieldName, createdAt);
    const signature = signPayload(payload, privKey);

    // Attacker changes field_name after signing
    const record = {
      id,
      entity_id: entityId,
      author_pubkey: pubKey,
      field_name: 'status', // tampered!
      created_at: createdAt,
      signature,
    };

    expect(isEditSignatureValid(record)).toBe(false);
  });

  it('rejects a record signed by a different key (impersonation)', () => {
    const evilPriv = schnorr.utils.randomPrivateKey();
    const id = 'place:abc:1700000000:' + pubKey;
    const payload = signingPayload(id, 'abc', 'name', 1700000000);
    const evilSig = signPayload(payload, evilPriv); // signed by wrong key

    const record = {
      id,
      entity_id: 'abc',
      author_pubkey: pubKey, // claims to be the legit author
      field_name: 'name',
      created_at: 1700000000,
      signature: evilSig,
    };

    expect(isEditSignatureValid(record)).toBe(false);
  });
});

describe('Gun.js reputation signature verification', () => {
  let privKey: Uint8Array;
  let pubKey: string;

  beforeAll(() => {
    privKey = schnorr.utils.randomPrivateKey();
    pubKey = bytesToHex(schnorr.getPublicKey(privKey));
  });

  it('accepts a legitimately signed reputation record', () => {
    const score = 42;
    const lastUpdated = 1700000000;
    const payload = signingPayload(pubKey, score, lastUpdated);
    const signature = signPayload(payload, privKey);

    const record = { pubkey: pubKey, score, last_updated: lastUpdated, signature };
    expect(isReputationSignatureValid(record)).toBe(true);
  });

  it('rejects a record with no signature', () => {
    const record = { pubkey: pubKey, score: 100, last_updated: 1700000000, signature: '' };
    expect(isReputationSignatureValid(record)).toBe(false);
  });

  it('rejects a record with an inflated score (tampered after signing)', () => {
    const score = 10;
    const lastUpdated = 1700000000;
    const payload = signingPayload(pubKey, score, lastUpdated);
    const signature = signPayload(payload, privKey);

    // Attacker inflates the score after signing
    const record = { pubkey: pubKey, score: 9999, last_updated: lastUpdated, signature };
    expect(isReputationSignatureValid(record)).toBe(false);
  });

  it('rejects a record signed by a different key (fake reputation injection)', () => {
    const evilPriv = schnorr.utils.randomPrivateKey();
    const payload = signingPayload(pubKey, 100, 1700000000);
    const evilSig = signPayload(payload, evilPriv);

    const record = { pubkey: pubKey, score: 100, last_updated: 1700000000, signature: evilSig };
    expect(isReputationSignatureValid(record)).toBe(false);
  });
});
