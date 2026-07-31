#!/usr/bin/env node
/**
 * Post-install patch for @atproto/oauth-client-expo.
 *
 * The published package (v0.1.8) has two problems on React Native:
 * 1. dist/index.js imports bare platform-specific paths that Metro can't resolve.
 * 2. The native Expo module it depends on is missing from the published package.
 *
 * This script patches the installed package after pnpm install:
 * - Rewrites dist/index.js to use explicit .native.js imports.
 * - Replaces dist/ExpoAtprotoOAuthClientModule.js with a pure-JS crypto polyfill
 *   using @noble/curves, @noble/hashes and expo-crypto.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

let packageRoot;
try {
  // The package's "exports" field points to ./dist/index.js, so resolving the
  // entry point gives us the dist directory directly.
  const entryPath = require.resolve('@atproto/oauth-client-expo');
  packageRoot = dirname(entryPath);
} catch {
  // Package not installed (e.g. during CI partial installs) — nothing to do.
  process.exit(0);
}

const distDir = packageRoot;

const indexPath = join(distDir, 'index.js');
const indexContent = readFileSync(indexPath, 'utf8');
writeFileSync(
  indexPath,
  indexContent
    .replace("import './polyfill';", "import './polyfill.native.js';")
    .replace(
      "export { ExpoOAuthClient } from './expo-oauth-client.js';",
      "export { ExpoOAuthClient } from './expo-oauth-client.native.js';",
    ),
);

const modulePath = join(distDir, 'ExpoAtprotoOAuthClientModule.js');
writeFileSync(
  modulePath,
  `// Polyfill for the ExpoAtprotoOAuthClient native module.
// The native source (Swift/Kotlin) is not included in @atproto/oauth-client-expo
// v0.1.8, so we provide a pure-JS implementation using @noble/curves and
// @noble/hashes (already dependencies of this project).
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import * as Crypto from 'expo-crypto';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

class ExpoAtprotoOAuthClientPolyfill {
  async digest(data, algo) {
    return sha256(data);
  }

  async getRandomValues(byteLength) {
    return Crypto.getRandomBytesAsync(byteLength);
  }

  async generatePrivateJwk(algorithm) {
    if (algorithm !== 'ES256') {
      throw new Error(\`Unsupported algorithm: \${algorithm}\`);
    }
    const priv = p256.utils.randomPrivateKey();
    const pub = p256.getPublicKey(priv, false);

    const x = pub.slice(1, 33);
    const y = pub.slice(33, 65);

    const kidBytes = sha256(pub);
    const kid = base64url(kidBytes).slice(0, 43);

    return {
      kty: 'EC',
      crv: 'P-256',
      kid,
      x: base64url(x),
      y: base64url(y),
      d: base64url(priv),
      alg: 'ES256',
    };
  }

  async createJwt(header, payload, jwk) {
    const headerB64 = base64url(textEncoder.encode(header));
    const payloadB64 = base64url(textEncoder.encode(payload));
    const signingInput = \`\${headerB64}.\${payloadB64}\`;

    const privBytes = base64urlToBytes(jwk.d);
    const sig = p256.sign(textEncoder.encode(signingInput), privBytes);
    const sigCompact = sig.toCompactRawBytes();
    const sigB64 = base64url(sigCompact);

    return \`\${signingInput}.\${sigB64}\`;
  }

  async verifyJwt(token, jwk, options = {}) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { protectedHeader: {}, payload: {}, valid: false };
    }

    const signingInput = \`\${parts[0]}.\${parts[1]}\`;
    const signature = base64urlToBytes(parts[2]);

    const xBytes = base64urlToBytes(jwk.x);
    const yBytes = base64urlToBytes(jwk.y);

    const pubBytes = new Uint8Array(65);
    pubBytes[0] = 0x04;
    pubBytes.set(xBytes, 1);
    pubBytes.set(yBytes, 33);

    let valid = false;
    try {
      valid = p256.verify(signature, textEncoder.encode(signingInput), pubBytes);
    } catch {
      valid = false;
    }

    const header = JSON.parse(textDecoder.decode(base64urlToBytes(parts[0])));
    const payload = JSON.parse(textDecoder.decode(base64urlToBytes(parts[1])));

    if (valid && options.audience && payload.aud !== options.audience) {
      valid = false;
    }

    return { protectedHeader: header, payload, valid };
  }
}

export default new ExpoAtprotoOAuthClientPolyfill();
`,
);

console.log('[patch-atproto-oauth] Patched @atproto/oauth-client-expo for React Native');
