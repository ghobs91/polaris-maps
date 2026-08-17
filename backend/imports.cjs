const path = require('node:path');

/**
 * Import overrides for bare-pack.
 *
 * `@noble/hashes/crypto` resolves to `cryptoNode.js` (which imports
 * `node:crypto`) under bare-pack's conditions, but the Bare runtime only
 * needs the pure-JS fallback: globalThis.crypto when available, else none.
 * Redirect to the CJS crypto.js to keep node builtins out of the bundle.
 */
module.exports = {
  '@noble/hashes/crypto': path.join(__dirname, 'node_modules', '@noble', 'hashes', 'crypto.js'),
};
