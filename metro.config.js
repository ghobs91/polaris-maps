const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package.json "exports" field resolution — required by
// @atproto/oauth-client-expo which uses conditional exports for
// .native.js platform-specific files.
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = config;
