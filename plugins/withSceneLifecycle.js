const { withDangerousMod, withInfoPlist } = require('expo/config-plugins');
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
 * Pins the scene-based AppDelegate required by the iOS 27 SDK.
 *
 * NOTE: iOS 27 asserts at launch unless the app adopts the UIScene lifecycle
 * ("Application failed to launch: UIScene life cycle is required for apps
 * built with this SDK"). The AppDelegate in plugins/native creates the React
 * native factory in `didFinishLaunchingWithOptions` and declares the
 * `SceneDelegate` (same file) that creates the window and starts React from
 * `scene(_:willConnectTo:options:)`.
 *
 * A previous scene-based attempt (ce0cc18) was reverted to a legacy
 * window-based AppDelegate because UIKit never connected the scene delegate
 * (black screen). That wiring failed because no `UIApplicationSceneManifest`
 * was added to Info.plist — this plugin now adds it via `withInfoPlist`.
 */
function withSceneLifecycle(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyAppDelegate();
      return cfg;
    },
  ]);

  config = withInfoPlist(config, (cfg) => {
    const manifest = cfg.modResults.UIApplicationSceneManifest ?? {};
    const configs = manifest.UISceneConfigurations ?? {};
    // Preserve any CarPlay scene added by withCarPlay regardless of plugin
    // order — overwriting the manifest here used to wipe it.
    configs.UIWindowSceneSessionRoleApplication = [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ];
    manifest.UISceneConfigurations = configs;
    // CarPlay shows a second scene (phone + car) simultaneously, so multiple
    // scenes must be enabled for the template scene to connect on device.
    manifest.UIApplicationSupportsMultipleScenes = true;
    cfg.modResults.UIApplicationSceneManifest = manifest;
    return cfg;
  });

  return config;
}

module.exports = withSceneLifecycle;
