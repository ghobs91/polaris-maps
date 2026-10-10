const { withDangerousMod } = require('expo/config-plugins');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Vendor the Bare native addons into react-native-bare-kit's `ios/addons`.
 *
 * The Bare worklets (traffic + Hyperdrive) link native addons — `sodium-native`
 * (Hyperswarm), `rocksdb-native` (Corestore/Hyperdrive), `udx-native`, … — which
 * the Bare runtime can only load from `.xcframework`s vendored into the app.
 * `react-native-bare-kit`'s podspec vendors `ios/addons/*.xcframework`; this
 * plugin runs `bare-link` (scanning the `backend/` worklet package) to produce
 * them during prebuild, before `pod install`.
 *
 * Requires `bare-link` (a react-native-bare-kit dependency) and the backend
 * worklet deps to be installed (`cd backend && npm install`).
 */
function linkBareAddons(projectRoot) {
  const out = path.join(projectRoot, 'node_modules', 'react-native-bare-kit', 'ios', 'addons');
  try {
    fs.mkdirSync(out, { recursive: true });
    execFileSync('pnpm', ['exec', 'bare-link', '--preset', 'ios', '--out', out, 'backend'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    console.log(`[withBareAddons] Linked Bare addons into ${out}`);
  } catch (e) {
    console.warn('[withBareAddons] bare-link failed:', e && e.message ? e.message : e);
  }
}

module.exports = function withBareAddons(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      linkBareAddons(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};
