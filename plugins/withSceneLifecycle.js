const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const APP_DELEGATE = {
  src: path.join(NATIVE_SRC, 'PolarisMaps', 'AppDelegate.swift'),
  dest: path.join(IOS_DIR, 'PolarisMaps', 'AppDelegate.swift'),
};

function copyAppDelegate() {
  if (!fs.existsSync(APP_DELEGATE.src)) {
    console.warn('[withSceneLifecycle] Source file not found: ' + APP_DELEGATE.src);
    return;
  }
  const destDir = path.dirname(APP_DELEGATE.dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(APP_DELEGATE.src, APP_DELEGATE.dest);
  console.log('[withSceneLifecycle] Copied ' + APP_DELEGATE.src + ' → ' + APP_DELEGATE.dest);
}

/**
 * Pins the legacy window-based AppDelegate (React root created directly in
 * `didFinishLaunchingWithOptions`).
 *
 * NOTE: the UIScene-based lifecycle (SceneDelegate + UIApplicationSceneManifest,
 * introduced in ce0cc18) was reverted because UIKit never connected the scene
 * delegate — the app launched to a black screen with no window and no React
 * runtime. The scene wiring is intentionally not re-added here.
 */
function withSceneLifecycle(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyAppDelegate();
      return cfg;
    },
  ]);

  return config;
}

module.exports = withSceneLifecycle;
