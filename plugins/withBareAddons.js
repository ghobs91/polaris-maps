const { withDangerousMod } = require('expo/config-plugins');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PODFILE_MARKER = 'polaris-fix-bare-addon-min-os';

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

/**
 * bare-link stamps every addon framework with a fixed `MinimumOSVersion` (14.0)
 * even when the binary is built for a newer OS (rocksdb-native is built at
 * 15.0). App Store Connect rejects that with ITMS-90208, so align each plist to
 * its binary right after linking.
 */
function normalizeAddonMinOS(projectRoot) {
  const script = path.join(projectRoot, 'scripts', 'fix-bare-addon-min-os.mjs');
  if (!fs.existsSync(script)) return;
  try {
    execFileSync('node', [script], { cwd: projectRoot, stdio: 'inherit' });
  } catch (e) {
    console.warn('[withBareAddons] min-OS normalization failed:', e && e.message ? e.message : e);
  }
}

/**
 * `react-native-bare-kit`'s podspec `prepare_command` regenerates the addons
 * during `pod install` (after this prebuild step), which would undo the fix.
 * Inject a call that re-runs the normalization after the addons are generated,
 * *inside* the existing `post_install` block — CocoaPods rejects a second
 * `post_install` hook. Idempotent via a marker comment.
 */
function injectPodfileHook(projectRoot) {
  const podfile = path.join(projectRoot, 'ios', 'Podfile');
  if (!fs.existsSync(podfile)) return;
  const contents = fs.readFileSync(podfile, 'utf8');
  if (contents.includes(PODFILE_MARKER)) return;

  const snippet = [
    `    # @generated begin ${PODFILE_MARKER} - expo prebuild (DO NOT MODIFY)`,
    '    # App Store validation (ITMS-90208) rejects embedded frameworks whose declared',
    '    # MinimumOSVersion is lower than the min-OS their binary was built for.',
    '    # bare-link regenerates the addon frameworks during pod install, normalize here.',
    "    bare_addon_minos = File.join(__dir__, '..', 'scripts', 'fix-bare-addon-min-os.mjs')",
    "    system('node', bare_addon_minos) if File.exist?(bare_addon_minos)",
    `    # @generated end ${PODFILE_MARKER}`,
  ].join('\n');

  const anchor = /^(\s*)post_install do \|installer\|\s*$/m;
  if (!anchor.test(contents)) {
    console.warn('[withBareAddons] no Podfile post_install block found — skipping min-OS hook');
    return;
  }
  fs.writeFileSync(podfile, contents.replace(anchor, (line) => `${line}\n${snippet}`));
  console.log('[withBareAddons] injected Podfile min-OS normalization hook');
}

module.exports = function withBareAddons(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      linkBareAddons(projectRoot);
      normalizeAddonMinOS(projectRoot);
      injectPodfileHook(projectRoot);
      return cfg;
    },
  ]);
};
