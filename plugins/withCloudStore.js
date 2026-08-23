const { withDangerousMod, withXcodeProject, withEntitlementsPlist } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const NATIVE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisCloudStore.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisCloudStore.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisCloudStore.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisCloudStore.m'),
  },
];

function copyFiles() {
  for (const { src, dest } of NATIVE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn('[withCloudStore] Source file not found: ' + src);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('[withCloudStore] Copied ' + src + ' → ' + dest);
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
      console.log('[withCloudStore] Registered ' + fileName + ' in Xcode project');
    } else {
      console.warn('[withCloudStore] Failed to register ' + fileName);
    }
  }
}

function patchBridgingHeader() {
  const bridgingHeader = path.join(IOS_DIR, 'PolarisMaps', 'PolarisMaps-Bridging-Header.h');
  if (!fs.existsSync(bridgingHeader)) {
    console.warn('[withCloudStore] Bridging header not found: ' + bridgingHeader);
    return;
  }

  let content = fs.readFileSync(bridgingHeader, 'utf8');
  if (content.includes('#import <React/RCTEventEmitter.h>')) {
    return;
  }
  if (!content.includes('#import <React/RCTBridgeModule.h>')) {
    content = content.trimEnd() + '\n\n#import <React/RCTBridgeModule.h>\n';
  }
  content = content.trimEnd() + '\n#import <React/RCTEventEmitter.h>\n';
  fs.writeFileSync(bridgingHeader, content);
  console.log('[withCloudStore] Patched PolarisMaps-Bridging-Header.h');
}

function withCloudStore(config) {
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.ubiquity-kvstore-identifier'] =
      '$(TeamIdentifierPrefix)$(CFBundleIdentifier)';
    return cfg;
  });

  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      patchBridgingHeader();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    registerNativeFiles(cfg.modResults);
    return cfg;
  });

  return config;
}

module.exports = withCloudStore;
