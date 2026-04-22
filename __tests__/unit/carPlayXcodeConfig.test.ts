import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('CarPlay iOS configuration', () => {
  it('keeps CarPlay scene registration while re-signing only simulator builds with CarPlay entitlements', () => {
    const infoPlist = readRepoFile('ios/PolarisMaps/Info.plist');
    const packageJson = readRepoFile('package.json');
    const installScript = readRepoFile('scripts/install-carplay-simulator.sh');
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
    expect(installScript).toContain('PolarisMaps.SimulatorCarPlay.entitlements');
    expect(installScript).toContain('codesign --force --sign - --entitlements');
    expect(installScript).toContain('xcrun simctl install booted');

    expect(xcodeProject).toContain('CarPlaySceneDelegate.swift in Sources');
    expect(xcodeProject).toContain('PolarisCarPlay.swift in Sources');
    expect(xcodeProject).toContain('PolarisCarPlay-Bridging.m in Sources');

    expect(simulatorEntitlements).toContain('<key>com.apple.developer.carplay-navigation</key>');
    expect(debugEntitlements).not.toContain('<key>com.apple.developer.carplay-navigation</key>');
    expect(releaseEntitlements).not.toContain('<key>com.apple.developer.carplay-navigation</key>');
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
