const { withInfoPlist, withXcodeProject, withEntitlementsPlist } = require('expo/config-plugins');

const EXTENSION_NAME = 'PolarisMapsLiveActivity';
const EXTENSION_BUNDLE_SUFFIX = '.live-activity';
const SWIFT_VERSION = '5.0';
const IOS_DEPLOYMENT_TARGET = '16.1';

function withLiveActivities(config) {
  // 1. Add NSSupportsLiveActivities to Info.plist (required for ActivityKit)
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    cfg.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return cfg;
  });

  // 2. Add Push Notifications capability (needed for remote live activity updates)
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.usernotifications.filtering'] = true;
    return cfg;
  });

  // 3. Add Widget Extension target to Xcode project
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const mainTarget = project.getFirstTarget();
    const mainTargetUuid = mainTarget?.uuid;

    if (!mainTargetUuid) {
      console.warn('[withLiveActivities] Could not find main target');
      return cfg;
    }

    const extensionDir = `ios/${EXTENSION_NAME}`;
    const relativePath = `../${EXTENSION_NAME}`;

    // Check if already added
    const existing = project.pbxTargetByName(EXTENSION_NAME);
    if (existing) {
      return cfg;
    }

    // --- Add group for extension files ---
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    let extGroup = mainGroup.children.find(
      (c) => c.comment === EXTENSION_NAME
    );
    if (!extGroup) {
      extGroup = project.addPbxGroup(
        [
          `${EXTENSION_NAME}/NavigationLiveActivity.swift`,
          `${EXTENSION_NAME}/PolarisMapsLiveActivityBundle.swift`,
          `${EXTENSION_NAME}/Info.plist`,
        ],
        EXTENSION_NAME,
        EXTENSION_NAME
      );
    }

    // --- Create the Widget Extension target ---
    const extTarget = project.addTarget(
      EXTENSION_NAME,
      'app_extension',
      EXTENSION_NAME,
      `${mainTarget.productName}.${EXTENSION_BUNDLE_SUFFIX}`,
      {
        productName: EXTENSION_NAME,
        deploymentTarget: IOS_DEPLOYMENT_TARGET,
        swiftVersion: SWIFT_VERSION,
      }
    );

    // --- Add source files to extension target ---
    // The extension needs NavigationAttributes.swift (shared with main app)
    const sharedAttributesPath = 'ios/PolarisMaps/NavigationAttributes.swift';
    const sharedAttributesFileRef = project.addFile(
      sharedAttributesPath,
      EXTENSION_NAME,
      extGroup.uuid,
    );

    const sourcesBuildPhase = extTarget.buildPhases.find(
      (bp) => bp.buildPhase === 'PBXSourcesBuildPhase'
    );
    if (sourcesBuildPhase) {
      const swiftFiles = [
        `${extensionDir}/NavigationLiveActivity.swift`,
        `${extensionDir}/PolarisMapsLiveActivityBundle.swift`,
      ];
      for (const filePath of swiftFiles) {
        const fileRef = project.addFile(
          filePath,
          EXTENSION_NAME,
          extGroup.uuid
        );
        if (fileRef) {
          project.addSourceFile(fileRef, { target: extTarget.uuid });
        }
      }
      // Add shared attributes file to extension target
      if (sharedAttributesFileRef) {
        project.addSourceFile(sharedAttributesFileRef, { target: extTarget.uuid });
      }
    }

    // --- Set extension Info.plist ---
    const extPlistPath = `${extensionDir}/Info.plist`;
    const buildSettings = extTarget.buildConfigurationList.buildConfigurations[0]
      ?.buildSettings;
    if (buildSettings) {
      buildSettings.INFOPLIST_FILE = extPlistPath;
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
      buildSettings.SWIFT_VERSION = SWIFT_VERSION;
      buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `$(PRODUCT_BUNDLE_IDENTIFIER)${EXTENSION_BUNDLE_SUFFIX}`;
      buildSettings.CODE_SIGN_STYLE = 'Automatic';
      buildSettings.MARKETING_VERSION = '0.1.0';
      buildSettings.CURRENT_PROJECT_VERSION = '1';
      buildSettings.GENERATE_INFOPLIST_FILE = 'YES';
      buildSettings.INFOPLIST_KEY_CFBundleDisplayName = 'Polaris Maps Live Activity';
      buildSettings.INFOPLIST_KEY_NSSupportsLiveActivities = 'YES';
      buildSettings.INFOPLIST_KEY_NSSupportsLiveActivitiesFrequentUpdates = 'YES';
    }

    // --- Add extension as dependency of main target ---
    project.addTargetDependency(mainTargetUuid, [extTarget.uuid]);

    // --- Add extension to Embed App Extensions build phase ---
    const embedPhase = mainTarget.buildPhases.find(
      (bp) =>
        bp.buildPhase === 'PBXCopyFilesBuildPhase' &&
        bp.name === 'Embed App Extensions'
    );
    if (embedPhase) {
      const extProduct = {
        isa: 'PBXBuildFile',
        fileRef: project.getFirstTarget().uuid,
      };
      embedPhase.files.push(extProduct);
    }

    return cfg;
  });

  return config;
}

module.exports = withLiveActivities;
