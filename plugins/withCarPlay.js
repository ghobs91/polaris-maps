const {
  withDangerousMod,
  withFinalizedMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');
const PBXPROJ_PATH = path.join(IOS_DIR, 'PolarisMaps.xcodeproj', 'project.pbxproj');

const NATIVE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisCarPlay.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisCarPlay.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisCarPlayMapView.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisCarPlayMapView.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'CarPlaySceneDelegate.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'CarPlaySceneDelegate.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisCarPlay-Bridging.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisCarPlay-Bridging.m'),
  },
];

const ENTITLEMENTS_FILES = [
  'PolarisMaps.Debug.entitlements',
  'PolarisMaps.SimulatorCarPlay.entitlements',
];

const CARPLAY_SCENE_ROLE = 'CPTemplateApplicationSceneSessionRoleApplication';
const SIMULATOR_ENTITLEMENTS_SETTING = 'CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]';
const SIGNATURE_WORKAROUND_PHASE = 'Remove signature files (Xcode workaround)';

function copyFiles() {
  for (const { src, dest } of NATIVE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn('[withCarPlay] Source file not found: ' + src);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('[withCarPlay] Copied ' + src + ' → ' + dest);
  }
}

function writeEntitlementsFiles() {
  // Base entitlements shared by all configurations. CarPlay keys are
  // deliberately absent: simulator testing re-signs via
  // scripts/resign-carplay-simulator-app.sh, and store-facing builds must not
  // carry unapproved CarPlay entitlements.
  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.developer.ubiquity-kvstore-identifier</key>
    <string>$(TeamIdentifierPrefix)$(CFBundleIdentifier)</string>
  </dict>
</plist>
`;
  for (const name of ENTITLEMENTS_FILES) {
    const dest = path.join(IOS_DIR, 'PolarisMaps', name);
    fs.writeFileSync(dest, contents);
    console.log('[withCarPlay] Wrote ' + dest);
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
      console.log('[withCarPlay] Registered ' + fileName + ' in Xcode project');
    } else {
      console.warn('[withCarPlay] Failed to register ' + fileName);
    }
  }
}

function applyBuildSettings(project) {
  const section = project.pbxXCBuildConfigurationSection();
  for (const [key, config] of Object.entries(section)) {
    if (key.endsWith('_comment') || !config || !config.name) continue;
    const settings = config.buildSettings;

    if (config.name === 'Debug') {
      settings.CODE_SIGN_ENTITLEMENTS = '"PolarisMaps/PolarisMaps.Debug.entitlements"';
    }
    if (config.name === 'Release') {
      settings.CODE_SIGN_ENTITLEMENTS = '"PolarisMaps/PolarisMaps.entitlements"';
    }
    settings[SIMULATOR_ENTITLEMENTS_SETTING] =
      '"PolarisMaps/PolarisMaps.SimulatorCarPlay.entitlements"';
  }
}

function ensureSignatureWorkaroundPhaseExists(project) {
  const objects = project.hash.project.objects;
  const phases = objects.PBXShellScriptBuildPhase || {};
  for (const [key, value] of Object.entries(phases)) {
    if (key.endsWith('_comment') || !value || value.isa !== 'PBXShellScriptBuildPhase') {
      continue;
    }
    if (
      value.name === SIGNATURE_WORKAROUND_PHASE ||
      (typeof value.shellScript === 'string' &&
        value.shellScript.includes(SIGNATURE_WORKAROUND_PHASE))
    ) {
      return;
    }
  }

  // No phase yet (fresh prebuild): create one covering both workarounds.
  const uuid = project.generateUuid();
  objects.PBXShellScriptBuildPhase[uuid] = {
    isa: 'PBXShellScriptBuildPhase',
    buildActionMask: 2147483647,
    files: [],
    inputPaths: [],
    name: SIGNATURE_WORKAROUND_PHASE,
    outputPaths: [],
    runOnlyForDeploymentPostprocessing: 0,
    shellPath: '/bin/sh',
    shellScript:
      '\n          echo "Remove signature files (Xcode workaround)";\n' +
      '          rm -rf "$CONFIGURATION_BUILD_DIR/MapLibre.xcframework-ios.signature";\n' +
      '          rm -f "$TARGET_BUILD_DIR/app-Simulated.xcent";\n        ',
  };
  objects.PBXShellScriptBuildPhase[uuid + '_comment'] = SIGNATURE_WORKAROUND_PHASE;

  const mainTarget = project.getFirstTarget();
  const targetEntry = objects.PBXNativeTarget[mainTarget.uuid];
  targetEntry.buildPhases.push({
    value: uuid,
    comment: SIGNATURE_WORKAROUND_PHASE,
  });
  console.log('[withCarPlay] Added signature-workaround script phase');
}

/**
 * Runs after the pbxproj is serialized. The xcode lib keeps escaped quotes in
 * parsed shell scripts, so text-level edits are the reliable way to extend an
 * existing script phase. Ensures:
 * - simulator CODE_SIGN_ENTITLEMENTS uses the canonical quoted-key form
 * - the signature-workaround phase also removes app-Simulated.xcent
 */
function normalizePbxprojText() {
  if (!fs.existsSync(PBXPROJ_PATH)) return;
  let content = fs.readFileSync(PBXPROJ_PATH, 'utf8');
  const original = content;

  content = content.replace(
    /^(\s*)CODE_SIGN_ENTITLEMENTS\[sdk=iphonesimulator\*\] = "([^"]+)";$/gm,
    '$1"CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]" = $2;',
  );

  const signatureRm = 'rm -rf \\"$CONFIGURATION_BUILD_DIR/MapLibre.xcframework-ios.signature\\";';
  const xcentRm = '\n          rm -f \\"$TARGET_BUILD_DIR/app-Simulated.xcent\\";';
  if (content.includes(signatureRm) && !content.includes('app-Simulated.xcent')) {
    content = content.replace(signatureRm, signatureRm + xcentRm);
  }

  if (content !== original) {
    fs.writeFileSync(PBXPROJ_PATH, content);
    console.log('[withCarPlay] Normalized project.pbxproj');
  }
}

function modifyXcodeProject(project) {
  registerNativeFiles(project);
  applyBuildSettings(project);
  ensureSignatureWorkaroundPhaseExists(project);
}

function withCarPlay(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      writeEntitlementsFiles();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    modifyXcodeProject(cfg.modResults);
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UISupportsCarPlay = true;
    const manifest = cfg.modResults.UIApplicationSceneManifest ?? {};
    // The phone UI and the CarPlay template scene are alive at the same time,
    // so multiple scenes must be enabled or iOS never connects the CarPlay
    // scene on a real head unit.
    manifest.UIApplicationSupportsMultipleScenes = true;
    manifest.UISceneConfigurations = manifest.UISceneConfigurations ?? {};
    // Keep the phone scene if withSceneLifecycle (or Expo defaults) defined it.
    manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication = manifest
      .UISceneConfigurations.UIWindowSceneSessionRoleApplication ?? [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ];
    // Apple requires the CarPlay entry to name the scene class explicitly —
    // without CPTemplateApplicationScene UIKit never creates a template scene
    // and the app is invisible in CarPlay.
    manifest.UISceneConfigurations[CARPLAY_SCENE_ROLE] = [
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'CarPlayTemplateScene',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate',
      },
    ];
    cfg.modResults.UIApplicationSceneManifest = manifest;
    return cfg;
  });

  // Runs after the pbxproj has been serialized; normalizes the simulator
  // CODE_SIGN_ENTITLEMENTS line to the canonical quoted-key form pinned by
  // __tests__/unit/carPlayXcodeConfig.test.ts.
  config = withFinalizedMod(config, [
    'ios',
    (cfg) => {
      normalizePbxprojText();
      return cfg;
    },
  ]);

  return config;
}

module.exports = withCarPlay;
