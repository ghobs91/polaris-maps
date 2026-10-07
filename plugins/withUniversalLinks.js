/**
 * Expo config plugin: iOS Universal Links for place sharing.
 *
 * Adds `com.apple.developer.associated-domains` (applinks:app.polarismaps.app) to
 * the app entitlements so `https://app.polarismaps.app/p/<id>` links open the app.
 *
 * OUT-OF-REPO REQUIREMENT: Universal Links also require an
 * `apple-app-site-association` (AASA) file served at
 * `https://app.polarismaps.app/.well-known/apple-app-site-association` containing
 * the app's `teamID.bundleID`. That file is hosted outside this repository and
 * must be deployed/updated independently; without it iOS will not open the app
 * from a web link (the `polaris-maps://` scheme fallback still works).
 *
 * ANDROID: Android App Links (assetlinks.json + intent filters) are
 * intentionally deferred — iOS is the current ship target.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

const ASSOCIATED_DOMAINS = ['applinks:app.polarismaps.app'];

const withUniversalLinks = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    const existing = cfg.modResults['com.apple.developer.associated-domains'] ?? [];
    const merged = [...new Set([...existing, ...ASSOCIATED_DOMAINS])];
    cfg.modResults['com.apple.developer.associated-domains'] = merged;
    return cfg;
  });

module.exports = withUniversalLinks;
