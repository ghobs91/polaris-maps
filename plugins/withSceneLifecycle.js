const { withDangerousMod, withXcodeProject, withInfoPlist } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const SCENE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'AppDelegate.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'AppDelegate.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'SceneDelegate.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'SceneDelegate.swift'),
  },
];

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

function copySceneFiles() {
  for (const { src, dest } of SCENE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn('[withSceneLifecycle] Source file not found: ' + src);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('[withSceneLifecycle] Copied ' + src + ' → ' + dest);
  }
}

function registerSceneDelegate(project) {
  const relativePath = 'PolarisMaps/SceneDelegate.swift';
  if (project.hasFile(relativePath)) {
    return project;
  }
  const groupUuid = project.findPBXGroupKey({ name: 'PolarisMaps' });
  const mainTarget = project.getFirstTarget();
  project.addSourceFile(relativePath, { target: mainTarget.uuid }, groupUuid);
  console.log('[withSceneLifecycle] Registered SceneDelegate.swift in Xcode project');
  return project;
}

function withSceneLifecycle(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copySceneFiles();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    cfg.modResults = registerSceneDelegate(cfg.modResults);
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return cfg;
  });

  return config;
}

module.exports = withSceneLifecycle;
