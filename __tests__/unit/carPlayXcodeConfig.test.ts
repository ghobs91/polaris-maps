import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('CarPlay iOS configuration', () => {
  it('keeps CarPlay scene registration while explicitly re-signing simulator builds with CarPlay entitlements', () => {
    const infoPlist = readRepoFile('ios/PolarisMaps/Info.plist');
    const packageJson = readRepoFile('package.json');
    const installScript = readRepoFile('scripts/install-carplay-simulator.sh');
    const resignScript = readRepoFile('scripts/resign-carplay-simulator-app.sh');
    const doctorScript = readRepoFile('scripts/doctor-carplay-simulator.sh');
    const scheme = readRepoFile(
      'ios/PolarisMaps.xcodeproj/xcshareddata/xcschemes/PolarisMaps.xcscheme',
    );
    const xcodeProject = readRepoFile('ios/PolarisMaps.xcodeproj/project.pbxproj');
    const simulatorEntitlements = readRepoFile(
      'ios/PolarisMaps/PolarisMaps.SimulatorCarPlay.entitlements',
    );
    const debugEntitlements = readRepoFile('ios/PolarisMaps/PolarisMaps.Debug.entitlements');
    const releaseEntitlements = readRepoFile('ios/PolarisMaps/PolarisMaps.entitlements');

    expect(infoPlist).toContain('<key>UISupportsCarPlay</key>');
    expect(infoPlist).toContain('CPTemplateApplicationSceneSessionRoleApplication');
    expect(infoPlist).toContain('CarPlaySceneDelegate');

    expect(packageJson).toContain('"carplay:sim": "sh scripts/install-carplay-simulator.sh"');
    expect(packageJson).toContain(
      '"carplay:resign": "CARPLAY_SKIP_BUILD=1 sh scripts/install-carplay-simulator.sh"',
    );
    expect(packageJson).toContain('"carplay:doctor": "sh scripts/doctor-carplay-simulator.sh"');
    expect(installScript).toContain(
      'DERIVED_DATA_PATH="$IOS_DIR/build/carplay-simulator-derived-data"',
    );
    expect(installScript).toContain(
      'RESIGN_SCRIPT="$ROOT_DIR/scripts/resign-carplay-simulator-app.sh"',
    );
    expect(installScript).toContain('APP_IDENTIFIER_KEY="application-identifier"');
    expect(installScript).toContain('CARPLAY_SKIP_BUILD');
    expect(installScript).toContain('find_latest_simulator_app()');
    expect(installScript).toContain('has_carplay_entitlement()');
    expect(installScript).toContain('has_application_identifier_entitlement()');
    expect(installScript).toContain('needs_resign=0');
    expect(installScript).toContain('xcrun simctl bootstatus "$DEVICE_ID" -b');
    expect(installScript).toContain('"$RESIGN_SCRIPT" "$APP_PATH"');
    expect(installScript).toContain('xcrun simctl install "$DEVICE_ID" "$APP_PATH"');
    expect(installScript).toContain('xcrun simctl get_app_container "$DEVICE_ID" "$BUNDLE_ID"');

    expect(resignScript).toContain('MERGED_ENTITLEMENTS_PATH');
    expect(resignScript).toContain('APP_IDENTIFIER_KEY="application-identifier"');
    expect(resignScript).toContain('/usr/libexec/PlistBuddy');
    expect(resignScript).toContain('Delete :$APP_IDENTIFIER_KEY');
    expect(resignScript).toContain('codesign --force --sign - --entitlements');
    expect(resignScript).toContain('com.apple.developer.carplay-maps');
    expect(resignScript).toContain('com.apple.developer.carplay-navigation');

    expect(doctorScript).toContain('CarPlay simulator diagnosis');
    expect(doctorScript).toContain('application-identifier');
    expect(doctorScript).toContain('SBMainWorkspace');
    expect(doctorScript).toContain('CPTemplateApplicationSceneSessionRoleApplication');
    expect(doctorScript).toContain('pnpm carplay:resign or pnpm carplay:sim');

    expect(scheme).not.toContain('Re-sign CarPlay simulator app');
    expect(scheme).not.toContain('resign-carplay-simulator-app.sh');

    expect(xcodeProject).toContain('CarPlaySceneDelegate.swift in Sources');
    expect(xcodeProject).toContain('PolarisCarPlay.swift in Sources');
    expect(xcodeProject).toContain('PolarisCarPlay-Bridging.m in Sources');
    expect(xcodeProject).toContain(
      '"CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]" = PolarisMaps/PolarisMaps.SimulatorCarPlay.entitlements;',
    );
    expect(xcodeProject).toContain('app-Simulated.xcent');
    const workaroundPhaseReferences =
      xcodeProject.match(/\/\* Remove signature files \(Xcode workaround\) \*\//g) ?? [];
    expect(workaroundPhaseReferences).toHaveLength(2);

    expect(simulatorEntitlements).not.toContain(
      '<key>com.apple.developer.carplay-navigation</key>',
    );
    expect(simulatorEntitlements).not.toContain('<key>com.apple.developer.carplay-maps</key>');
    expect(debugEntitlements).not.toContain('<key>com.apple.developer.carplay-maps</key>');
    expect(releaseEntitlements).not.toContain('<key>com.apple.developer.carplay-maps</key>');
  });

  it('buffers CarPlay scene state until the React Native module attaches', () => {
    const sceneDelegate = readRepoFile('ios/PolarisMaps/CarPlaySceneDelegate.swift');
    const nativeModule = readRepoFile('ios/PolarisMaps/PolarisCarPlay.swift');

    expect(sceneDelegate).toContain('PolarisCarPlay.sceneDidConnect');
    expect(sceneDelegate).toContain('PolarisCarPlay.sceneDidDisconnect');
    expect(nativeModule).toContain('private static var pendingInterfaceController');
    expect(nativeModule).toContain('private static var isSceneConnected = false');
    expect(nativeModule).toContain('attachPendingSceneIfNeeded()');
    expect(nativeModule).toContain('resolve(Self.isSceneConnected)');
  });
});
