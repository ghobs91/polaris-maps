/**
 * Expo config plugin: MapLibre accessibility-container patch.
 *
 * Copies `plugins/native/PolarisMaps/PolarisMapAccessibility.m` into the iOS
 * target and registers it. The file replaces MLNMapView's accessibility
 * container with a bounds-safe, query-free one, which removes an intermittent
 * SIGABRT during VoiceOver / accessibility enumeration.
 *
 * Background and repro: docs/map-accessibility-crash.md.
 *
 * No portal capability or entitlement is required — this is app code only.
 */
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const NATIVE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisMapAccessibility.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisMapAccessibility.m'),
  },
];

function copyFiles() {
  for (const { src, dest } of NATIVE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn('[withMapAccessibility] Source file not found: ' + src);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('[withMapAccessibility] Copied ' + src + ' → ' + dest);
  }
}

function registerNativeFiles(project) {
  const groupUuid = project.findPBXGroupKey({ name: 'PolarisMaps' });
  const mainTarget = project.getFirstTarget();

  for (const { dest } of NATIVE_FILES) {
    const relativePath = dest.replace(/^ios\//, '');
    const fileName = path.basename(dest);

    if (project.hasFile(relativePath)) {
      continue;
    }

    const file = project.addSourceFile(relativePath, { target: mainTarget.uuid }, groupUuid);
    if (file) {
      console.log('[withMapAccessibility] Registered ' + fileName + ' in Xcode project');
    } else {
      console.warn('[withMapAccessibility] Failed to register ' + fileName);
    }
  }
}

function withMapAccessibility(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    registerNativeFiles(cfg.modResults);
    return cfg;
  });

  return config;
}

module.exports = withMapAccessibility;
