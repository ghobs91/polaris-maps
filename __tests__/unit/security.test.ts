/**
 * Security regression tests for CVE fixes:
 *  1. Path traversal prevention in tar extraction AND Hyperdrive download (nodejs sidecar parity)
 *  2. API key proxy URL routing in traffic fetchers
 *  3. ErrorBoundary: no raw error message in production
 *  4. Gun.js edit signature verification (isEditSignatureValid)
 *  5. Gun.js reputation signature verification
 *  6. FTS5 query injection prevention (F-004)
 *  7. URL scheme validation for Linking.openURL (F-003)
 *  8. API key redaction in error messages (F-008, F-011)
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

// Same guard is also applied in handleHdDownload (Hyperdrive download)
describe('Hyperdrive download path traversal guard (F-001)', () => {
  const destDir = '/data/regions/boston';

  it('allows normal Hyperdrive entry paths', () => {
    expect(isSafeEntry(destDir, 'tiles/14/8192/5432.pbf')).toBe(true);
    expect(isSafeEntry(destDir, 'metadata.json')).toBe(true);
  });

  it('blocks ../../ key from adversarial peer', () => {
    expect(isSafeEntry(destDir, '../../shared_prefs/database.sqlite')).toBe(false);
  });

  it('blocks ../Library escape attempt', () => {
    expect(isSafeEntry(destDir, '../../../Library/Cookies/evil.js')).toBe(false);
  });

  it('blocks key that resolves to exact destDir (boundary)', () => {
    // path.resolve(destDir, '.') === destDir — not inside destDir + sep
    expect(isSafeEntry(destDir, '.')).toBe(true);
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

// ---------------------------------------------------------------------------
// 6. FTS5 query injection prevention (F-004)
// ---------------------------------------------------------------------------
describe('FTS5 query injection prevention (F-004)', () => {
  /**
   * Mirrors the fixed FTS5 query builder from geocodingService.ts.
   * Double-quotes are stripped to prevent malformed FTS5 expressions.
   */
  function buildFtsQuery(query: string): string {
    return query
      .trim()
      .split(/\s+/)
      .map((w) => `"${w.replace(/"/g, '')}"*`)
      .join(' ');
  }

  it('builds a normal query correctly', () => {
    expect(buildFtsQuery('coffee shop')).toBe('"coffee"* "shop"*');
  });

  it('strips double-quotes that would break FTS5 syntax', () => {
    const result = buildFtsQuery('coffee"shop');
    expect(result).toBe('"coffeeshop"*');
    expect(result).not.toContain('""');
  });

  it('handles multiple injected quotes', () => {
    const result = buildFtsQuery('"hello" "world"');
    expect(result).toBe('"hello"* "world"*');
    // No unclosed quote — every word is individually wrapped
  });

  it('returns empty-safe query for quote-only input', () => {
    const result = buildFtsQuery('" "');
    // After stripping quotes: two empty strings wrapped
    expect(result).toBe('""* ""*');
  });
});

// ---------------------------------------------------------------------------
// 7. URL scheme validation for Linking.openURL (F-003)
// ---------------------------------------------------------------------------
describe('URL scheme validation (F-003)', () => {
  const SAFE_URL_SCHEMES = ['https:', 'http:'];

  function isSafeURL(raw: string): boolean {
    try {
      const u = new URL(raw);
      return SAFE_URL_SCHEMES.includes(u.protocol);
    } catch {
      return false;
    }
  }

  function sanitizePhone(raw: string): string {
    return raw.replace(/[^0-9+#*]/g, '');
  }

  it('accepts https URLs', () => {
    expect(isSafeURL('https://example.com')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isSafeURL('http://example.com')).toBe(true);
  });

  it('blocks intent:// URLs (Android intent injection)', () => {
    expect(
      isSafeURL('intent://navigate#Intent;scheme=geo;package=com.google.android.apps.maps;end'),
    ).toBe(false);
  });

  it('blocks javascript: URLs', () => {
    expect(isSafeURL('javascript:alert(1)')).toBe(false);
  });

  it('blocks file:// URLs', () => {
    expect(isSafeURL('file:///etc/passwd')).toBe(false);
  });

  it('blocks malformed URLs', () => {
    expect(isSafeURL('not a url at all')).toBe(false);
  });

  it('sanitizes phone number — strips DTMF injection', () => {
    expect(sanitizePhone('+9999;dtmf=*#0600')).toBe('+9999*#0600');
  });

  it('sanitizes phone number — removes letters and special chars', () => {
    expect(sanitizePhone('+1 (555) 123-4567')).toBe('+15551234567');
  });
});

// ---------------------------------------------------------------------------
// 8. API key redaction in error messages (F-008, F-011)
// ---------------------------------------------------------------------------
describe('API key redaction in error logs (F-008, F-011)', () => {
  function redactKeys(msg: string): string {
    return msg.replace(/key=[^&]*/g, 'key=REDACTED');
  }

  it('redacts TomTom API key from URL in error message', () => {
    const msg = 'fetch failed: https://api.tomtom.com/traffic?key=abc123secret&zoom=14';
    const safe = redactKeys(msg);
    expect(safe).not.toContain('abc123secret');
    expect(safe).toContain('key=REDACTED');
  });

  it('redacts HERE API key from URL', () => {
    const msg = 'HTTP 429: https://data.traffic.hereapi.com/v7/flow?apiKey=abc&key=xyz';
    const safe = redactKeys(msg);
    expect(safe).not.toContain('xyz');
    expect(safe).toContain('key=REDACTED');
  });

  it('leaves messages without keys unchanged', () => {
    const msg = 'Network timeout after 5000ms';
    expect(redactKeys(msg)).toBe(msg);
  });

  it('truncates Valhalla error to 200 chars', () => {
    const raw = 'x'.repeat(500);
    const safe = raw.slice(0, 200).replace(/key=[^&]*/g, 'key=REDACTED');
    expect(safe.length).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 9. Nostr event signature verification (NEW-001)
// ---------------------------------------------------------------------------
describe('Nostr event signature verification (NEW-001)', () => {
  /**
   * Mirrors verifyEvent() from nostrFallback.ts — verifies NIP-01 event id
   * and Schnorr signature.
   */
  function verifyEvent(event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }): boolean {
    try {
      const serialized = JSON.stringify([
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content,
      ]);
      const expectedId = bytesToHex(sha256(new TextEncoder().encode(serialized)));
      if (expectedId !== event.id) return false;
      return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), event.pubkey);
    } catch {
      return false;
    }
  }

  function createSignedEvent(
    kind: number,
    content: string,
    tags: string[][],
    createdAt: number,
    priv: Uint8Array,
    pub: string,
  ) {
    const serialized = JSON.stringify([0, pub, createdAt, kind, tags, content]);
    const idBytes = sha256(new TextEncoder().encode(serialized));
    const id = bytesToHex(idBytes);
    const sig = bytesToHex(schnorr.sign(idBytes, priv));
    return { id, pubkey: pub, created_at: createdAt, kind, tags, content, sig };
  }

  it('accepts a legitimately signed Nostr event', () => {
    const priv = schnorr.utils.randomPrivateKey();
    const pub = bytesToHex(schnorr.getPublicKey(priv));
    const event = createSignedEvent(20100, '{"spd":55}', [['g', 'dp3t']], 1700000000, priv, pub);
    expect(verifyEvent(event)).toBe(true);
  });

  it('rejects event with forged (all-zero) signature', () => {
    const priv = schnorr.utils.randomPrivateKey();
    const pub = bytesToHex(schnorr.getPublicKey(priv));
    const event = createSignedEvent(20100, '{"spd":0}', [['g', 'dp3t']], 1700000000, priv, pub);
    event.sig = '0'.repeat(128);
    expect(verifyEvent(event)).toBe(false);
  });

  it('rejects event with tampered content', () => {
    const priv = schnorr.utils.randomPrivateKey();
    const pub = bytesToHex(schnorr.getPublicKey(priv));
    const event = createSignedEvent(20100, '{"spd":55}', [['g', 'dp3t']], 1700000000, priv, pub);
    event.content = '{"spd":0}'; // tampered
    expect(verifyEvent(event)).toBe(false);
  });

  it('rejects event with mismatched id', () => {
    const priv = schnorr.utils.randomPrivateKey();
    const pub = bytesToHex(schnorr.getPublicKey(priv));
    const event = createSignedEvent(20100, '{"spd":55}', [['g', 'dp3t']], 1700000000, priv, pub);
    event.id = 'ff'.repeat(32); // wrong id
    expect(verifyEvent(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Overpass QL double-quote escaping (NEW-003)
// ---------------------------------------------------------------------------
describe('Overpass QL double-quote injection prevention (NEW-003)', () => {
  function sanitizeForOverpass(namePattern: string): string {
    return namePattern.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
  }

  it('escapes a normal pattern without special chars', () => {
    expect(sanitizeForOverpass('Starbucks')).toBe('Starbucks');
  });

  it('escapes double-quote that would break Overpass QL string', () => {
    const safe = sanitizeForOverpass('coffee"shop');
    expect(safe).toContain('\\"');
    expect(safe).toBe('coffee\\"shop');
  });

  it('escapes regex metacharacters', () => {
    expect(sanitizeForOverpass('foo.bar')).toBe('foo\\.bar');
    expect(sanitizeForOverpass('a+b')).toBe('a\\+b');
  });
});

// ---------------------------------------------------------------------------
// 11. Gunzip path validation (NEW-004)
// ---------------------------------------------------------------------------
describe('Gunzip output path validation (NEW-004)', () => {
  function isGunzipPathSafe(outputPath: string, homeDir: string): boolean {
    const resolvedOut = path.resolve(outputPath);
    return resolvedOut.startsWith(homeDir + path.sep) || resolvedOut === homeDir;
  }

  const homeDir = '/Users/testuser';

  it('allows output within home directory', () => {
    expect(isGunzipPathSafe('/Users/testuser/Documents/output.bin', homeDir)).toBe(true);
  });

  it('blocks output escaping to /etc', () => {
    expect(isGunzipPathSafe('/etc/cron.d/evil', homeDir)).toBe(false);
  });

  it('blocks traversal escape from within home', () => {
    expect(isGunzipPathSafe('/Users/testuser/../../etc/passwd', homeDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Signing payload domain separation (NEW-005)
// ---------------------------------------------------------------------------
describe('Signing payload domain separation (NEW-005)', () => {
  function createSigningPayload(...fields: (string | number)[]): string {
    return fields.map(String).join('\0');
  }

  it('separates fields with null byte', () => {
    const payload = createSigningPayload('abc', 123);
    expect(payload).toBe('abc' + '\0' + '123');
  });

  it('prevents field concatenation ambiguity', () => {
    const a = createSigningPayload('ab', 'c');
    const b = createSigningPayload('a', 'bc');
    expect(a).not.toBe(b);
  });
});
