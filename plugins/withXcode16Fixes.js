const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const IOS_DIR = 'ios';
const PODFILE = path.join(IOS_DIR, 'Podfile');

function disableSandboxingInProject(project) {
  const targetName = project.getFirstTarget().name;
  project.updateBuildProperty('ENABLE_USER_SCRIPT_SANDBOXING', 'NO', null, targetName);
  return project;
}

function patchPodfileSandboxing() {
  if (!fs.existsSync(PODFILE)) {
    console.warn('[withXcode16Fixes] Podfile not found, skipping Podfile patch');
    return;
  }
  let content = fs.readFileSync(PODFILE, 'utf8');
  if (content.includes('ENABLE_USER_SCRIPT_SANDBOXING')) {
    return;
  }
  const hook = 'post_install do |installer|';
  const idx = content.indexOf(hook);
  if (idx === -1) {
    console.warn('[withXcode16Fixes] post_install hook not found in Podfile');
    return;
  }
  const injection = `\n    # Xcode 16+ user script sandboxing breaks many React Native/Expo script phases.\n    installer.pods_project.targets.each do |target|\n      target.build_configurations.each do |config|\n        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'\n      end\n    end\n    installer.pods_project.build_configurations.each do |config|\n      config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'\n    end\n`;
  content = content.slice(0, idx + hook.length) + injection + content.slice(idx + hook.length);
  fs.writeFileSync(PODFILE, content);
  console.log('[withXcode16Fixes] Patched Podfile to disable user script sandboxing');
}

function withXcode16Fixes(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      patchPodfileSandboxing();
      return cfg;
    },
  ]);
  config = withXcodeProject(config, (cfg) => {
    cfg.modResults = disableSandboxingInProject(cfg.modResults);
    return cfg;
  });
  return config;
}

module.exports = withXcode16Fixes;
