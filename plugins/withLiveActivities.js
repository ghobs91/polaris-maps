const {
  withInfoPlist,
  withXcodeProject,
  withEntitlementsPlist,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const EXTENSION_NAME = 'PolarisMapsLiveActivity';
const EXTENSION_BUNDLE_SUFFIX = '.live-activity';
const SWIFT_VERSION = '5.0';
const IOS_DEPLOYMENT_TARGET = '16.1';

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const NATIVE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'NavigationAttributes.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'NavigationAttributes.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisLiveActivity.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisLiveActivity.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisLiveActivity.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisLiveActivity.m'),
  },
];

const EXTENSION_FILES = [
  {
    src: path.join(NATIVE_SRC, EXTENSION_NAME, 'NavigationLiveActivity.swift'),
    dest: path.join(IOS_DIR, EXTENSION_NAME, 'NavigationLiveActivity.swift'),
  },
  {
    src: path.join(NATIVE_SRC, EXTENSION_NAME, 'PolarisMapsLiveActivityBundle.swift'),
    dest: path.join(IOS_DIR, EXTENSION_NAME, 'PolarisMapsLiveActivityBundle.swift'),
  },
  {
    src: path.join(NATIVE_SRC, EXTENSION_NAME, 'Info.plist'),
    dest: path.join(IOS_DIR, EXTENSION_NAME, 'Info.plist'),
  },
];

function copyFiles() {
  for (const { src, dest } of [...NATIVE_FILES, ...EXTENSION_FILES]) {
    if (!fs.existsSync(src)) {
      console.warn(`[withLiveActivities] Source file not found: ${src}`);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

function patchBridgingHeader() {
  const bridgingHeader = path.join(IOS_DIR, 'PolarisMaps', 'PolarisMaps-Bridging-Header.h');
  if (fs.existsSync(bridgingHeader)) {
    let content = fs.readFileSync(bridgingHeader, 'utf8');
    if (!content.includes('#import <React/RCTBridgeModule.h>')) {
      content = content.trimEnd() + '\n\n#import <React/RCTBridgeModule.h>\n';
      fs.writeFileSync(bridgingHeader, content);
    }
  }
}

function patchPodfile() {
  const podfilePath = path.join(IOS_DIR, 'Podfile');
  if (!fs.existsSync(podfilePath)) return;

  let content = fs.readFileSync(podfilePath, 'utf8');
  if (content.includes('FMT_CONSTEVAL_PATCHED')) return;

  const fmtFix = `    # Fix fmt 11.x consteval issue with iOS 26 SDK / Xcode 26.
    # Patches fmt/base.h after pod install downloads fresh sources.
    fmt_base_h = File.join(__dir__, 'Pods', 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base_h)
      content = File.read(fmt_base_h)
      unless content.include?('FMT_CONSTEVAL_PATCHED')
        lines = content.lines
        new_lines = []
        i = 0
        while i < lines.length
          line = lines[i]
          if line.include?('Detect consteval, C++20 constexpr extensions')
            new_lines << "// FMT_CONSTEVAL_PATCHED: Force consteval off for iOS 26 SDK / Xcode 26 compatibility.\\n"
            new_lines << "#define FMT_USE_CONSTEVAL 0\\n"
            new_lines << "#define FMT_CONSTEVAL\\n"
            new_lines << "#define FMT_CONSTEXPR20\\n"
            found_first_endif = false
            i += 1
            while i < lines.length
              if lines[i].strip == '#if FMT_USE_CONSTEVAL' && found_first_endif
                i += 1
                while i < lines.length
                  break if lines[i].strip == '#endif'
                  i += 1
                end
                break
              end
              if lines[i].strip == '#endif' && !found_first_endif
                found_first_endif = true
              end
              i += 1
            end
          else
            new_lines << line
          end
          i += 1
        end
        FileUtils.chmod(0644, fmt_base_h)
        File.write(fmt_base_h, new_lines.join)
      end
    end
`;

  // Insert inside the post_install block after the resource-bundle-fix code
  const oldBlock = `          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end
  end`;
  const newBlock = `          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end

${fmtFix}
  end`;

  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(podfilePath, content);
}

function withLiveActivities(config) {
  const appBundleId = config.ios?.bundleIdentifier || config.expo?.ios?.bundleIdentifier;
  const extensionBundleId = appBundleId ? `${appBundleId}${EXTENSION_BUNDLE_SUFFIX}` : undefined;

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    cfg.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return cfg;
  });

  config = withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['com.apple.developer.usernotifications.filtering'];
    return cfg;
  });

  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      patchPodfile();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    patchBridgingHeader();

    const project = cfg.modResults;
    const mainTarget = project.getFirstTarget();
    const mainTargetUuid = mainTarget?.uuid;

    if (!mainTargetUuid) {
      console.warn('[withLiveActivities] Could not find main target');
      return cfg;
    }

    let extTarget = project.pbxTargetByName(EXTENSION_NAME);
    if (!extTarget) {
      extTarget = project.addTarget(
        EXTENSION_NAME,
        'app_extension',
        EXTENSION_NAME,
        extensionBundleId,
      );

      const extGroup = project.addPbxGroup([], EXTENSION_NAME, EXTENSION_NAME);

      const addExtensionSource = (filePath) => {
        const file = project.addSourceFile(filePath, { target: extTarget.uuid }, extGroup.uuid);
        if (!file) {
          const existingFile = project.addFile(filePath, extGroup.uuid);
          if (existingFile) {
            existingFile.target = extTarget.uuid;
            existingFile.uuid = project.generateUuid();
            project.addToPbxBuildFileSection(existingFile);
            project.addToPbxSourcesBuildPhase(existingFile);
          }
        }
      };

      addExtensionSource(`${EXTENSION_NAME}/NavigationLiveActivity.swift`);
      addExtensionSource(`${EXTENSION_NAME}/PolarisMapsLiveActivityBundle.swift`);
      addExtensionSource('PolarisMaps/NavigationAttributes.swift');
      project.addFile(`${EXTENSION_NAME}/Info.plist`, extGroup.uuid);
    }

    const configListUuid = extTarget.pbxNativeTarget.buildConfigurationList;
    const configList = project.pbxXCConfigurationList()[configListUuid];
    if (configList) {
      for (const buildConfig of configList.buildConfigurations) {
        const buildSettings =
          project.pbxXCBuildConfigurationSection()[buildConfig.value]?.buildSettings;
        if (buildSettings) {
          buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
          buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
          buildSettings.SWIFT_VERSION = SWIFT_VERSION;
          buildSettings.CODE_SIGN_STYLE = 'Manual';
          buildSettings.MARKETING_VERSION = '0.1.0';
          buildSettings.CURRENT_PROJECT_VERSION = '1';
          buildSettings.GENERATE_INFOPLIST_FILE = 'YES';
          if (extensionBundleId) {
            buildSettings.PRODUCT_BUNDLE_IDENTIFIER = extensionBundleId;
          }
          buildSettings.INFOPLIST_KEY_CFBundleDisplayName = '"Polaris Maps Live Activity"';
          buildSettings.INFOPLIST_KEY_NSSupportsLiveActivities = 'YES';
          buildSettings.INFOPLIST_KEY_NSSupportsLiveActivitiesFrequentUpdates = 'YES';
        }
      }
    }

    return cfg;
  });

  return config;
}

module.exports = withLiveActivities;
