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
    // Dashboard + instrument-cluster scenes (iOS 13.4 / 15.4).
    expect(infoPlist).toContain('CPTemplateApplicationDashboardSceneSessionRoleApplication');
    // Apple's opt-in for the Dashboard split view; without it the system keeps
    // showing Apple Maps instead of this app's navigation map.
    expect(infoPlist).toContain('<key>CPSupportsDashboardNavigationScene</key>');
    expect(infoPlist).toContain(
      'CPTemplateApplicationInstrumentClusterSceneSessionRoleApplication',
    );
    expect(infoPlist).toContain('CarPlayDashboardSceneDelegate');
    expect(infoPlist).toContain('CarPlayInstrumentClusterSceneDelegate');
    const appDelegate = readRepoFile('ios/PolarisMaps/AppDelegate.swift');
    expect(appDelegate).toContain('CarPlayDashboardSceneDelegate');
    expect(appDelegate).toContain('CarPlayInstrumentClusterSceneDelegate');

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
    // CarPlay Simulator eligibility: sign with a Development profile that grants
    // carplay-maps, falling back to ad-hoc stripping when none is installed.
    const profileSignScript = readRepoFile('scripts/sign-carplay-simulator-app-with-profile.sh');
    expect(installScript).toContain('SIGN_WITH_PROFILE_SCRIPT');
    expect(installScript).toContain('sign-carplay-simulator-app-with-profile.sh');
    expect(profileSignScript).toContain('com.apple.developer.carplay-maps');
    expect(profileSignScript).toContain('get-task-allow');
    expect(profileSignScript).toContain('embedded.mobileprovision');
    expect(profileSignScript).toContain('CARPLAY_PROVISIONING_PROFILE');
    expect(resignScript).toContain('embedded.mobileprovision');
    expect(doctorScript).toContain('has_embedded_profile');

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
    // Debug device builds carry the entitlement so the CarPlay Simulator (real
    // device) lists the app; the development profile authorizes it.
    expect(debugEntitlements).toContain('<key>com.apple.developer.carplay-maps</key>');
    expect(releaseEntitlements).toContain('<key>com.apple.developer.carplay-maps</key>');
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

  it('attaches the buffered CarPlay scene on the main thread', () => {
    // startObserving/init run on RN bridge queues; activating UIKit templates
    // off-main raises and aborts the process (SIGABRT on CarPlay connect).
    const nativeModule = readRepoFile('ios/PolarisMaps/PolarisCarPlay.swift');

    expect(nativeModule).toContain('Thread.isMainThread');
    expect(nativeModule).toContain(
      'DispatchQueue.main.async { Self.attachPendingSceneIfNeeded() }',
    );
  });

  it('keeps asynchronous search results connected to the CarPlay completion handler', () => {
    const nativeModule = readRepoFile('plugins/native/PolarisMaps/PolarisCarPlay.swift');

    expect(nativeModule).toContain('private var pendingSearchCompletion');
    expect(nativeModule).toContain('finishPendingSearch()');
    expect(nativeModule).toContain('searchItems = items\n    finishPendingSearch()');
    expect(nativeModule).toContain('pendingSearchCompletion = completionHandler');
    expect(nativeModule).toContain('completionHandler: @escaping ([CPListItem]) -> Void');
  });

  it('keeps the committed ios/ CarPlay sources in sync with the plugin sources', () => {
    // CI builds ios/ without running prebuild, so withCarPlay's copy step is
    // bypassed: both copies must be identical by hand.
    for (const file of [
      'PolarisCarPlay.swift',
      'PolarisCarPlayMapView.swift',
      'CarPlaySceneDelegate.swift',
      'AppDelegate.swift',
    ]) {
      expect(readRepoFile(`ios/PolarisMaps/${file}`)).toBe(
        readRepoFile(`plugins/native/PolarisMaps/${file}`),
      );
    }
  });

  it('declares every emitted CarPlay event in supportedEvents', () => {
    // RCTEventEmitter throws when JS subscribes to an event that isn't listed
    // in supportedEvents(); this catches a missing declaration at test time.
    for (const root of ['plugins/native/PolarisMaps', 'ios/PolarisMaps']) {
      const nativeModule = readRepoFile(`${root}/PolarisCarPlay.swift`);
      const supportedStart = nativeModule.indexOf(
        'return [',
        nativeModule.indexOf('supportedEvents'),
      );
      const supportedEnd = nativeModule.indexOf(']', supportedStart);
      const supported = nativeModule.slice(supportedStart, supportedEnd);
      const emitted = new Set(
        [...nativeModule.matchAll(/emit\(\s*"([^"]+)"/g)].map((match) => match[1]),
      );
      expect(emitted.size).toBeGreaterThan(0);
      for (const name of emitted) {
        expect(supported).toContain(`"${name}"`);
      }
    }
  });

  it('bridges every native CarPlay method the JS manager calls', () => {
    // Every @objc method must have an RCT_EXTERN_METHOD declaration, otherwise
    // the JS call silently no-ops (map style, route traffic, reroute alert).
    const swift = readRepoFile('plugins/native/PolarisMaps/PolarisCarPlay.swift');
    const bridge = readRepoFile('plugins/native/PolarisMaps/PolarisCarPlay-Bridging.m');
    const methods = [...swift.matchAll(/@objc\s+func\s+(\w+)/g)].map((match) => match[1]);
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      expect(bridge).toContain(`RCT_EXTERN_METHOD(${method}`);
    }
    expect(readRepoFile('ios/PolarisMaps/PolarisCarPlay-Bridging.m')).toBe(bridge);
  });

  it('mirrors the phone UI on CarPlay: summaries, banner text, map style, add-stop', () => {
    for (const root of ['plugins/native/PolarisMaps', 'ios/PolarisMaps']) {
      const nativeModule = readRepoFile(`${root}/PolarisCarPlay.swift`);
      const mapView = readRepoFile(`${root}/PolarisCarPlayMapView.swift`);

      // Phone route-preview summary + banner text ride the start payload.
      expect(nativeModule).toContain('routeSummary');
      expect(nativeModule).toContain('displayInstruction');
      expect(nativeModule).toContain('payload.routeSummary ??');
      // Phone map style (dark/light, satellite) applied to the CarPlay map.
      expect(nativeModule).toContain('func updateMapStyle(_ json: String)');
      expect(nativeModule).toContain('func applyMapStyle(_ json: String)');
      expect(nativeModule).toContain('appliedStyleHash');
      expect(mapView).toContain('func applyStyle(json: String)');
      expect(mapView).toContain('polaris-carplay-style-');
      // Route + destination render as style layers (mirroring the phone's
      // TrafficRouteLayer), which is what reliably paints in the CarPlay window.
      expect(mapView).toContain('MLNLineStyleLayer');
      expect(mapView).toContain('MLNShapeSource');
      expect(mapView).toContain('rebuildRouteLayers');
      expect(mapView).toContain('polaris-route-destination-symbol');
      // Failed styles never park the route forever.
      expect(mapView).toContain('mapViewDidFailLoadingMap');
      // Search results offer Start vs Add Stop like the phone place card.
      expect(nativeModule).toContain('searchResultAddStop');
      expect(nativeModule).toContain('Add Stop');
      expect(nativeModule).toContain('Start Navigation');
      expect(nativeModule).toContain('popToRootTemplate');
      // Apple/Google-style trip preview with route choices + Go.
      expect(nativeModule).toContain('showTripPreview');
      expect(nativeModule).toContain('selectedPreviewFor');
      expect(nativeModule).toContain('startedTrip');
      expect(mapView).toContain('polaris-route-alternates');
      // CarPlay chrome parity: guidance tint, car light/dark, nav-bar buttons.
      expect(nativeModule).toContain('guidanceBackgroundColor');
      expect(nativeModule).toContain('contentStyleChanged');
      expect(nativeModule).toContain('leadingNavigationBarButtons');
      expect(nativeModule).toContain('showPanningInterface');
      // Arrival card, incident warnings, and native lane guidance (17.4+).
      expect(nativeModule).toContain('showArrival');
      expect(nativeModule).toContain('carPlayArrivalDismiss');
      expect(nativeModule).toContain('showIncidentAlert');
      expect(nativeModule).toContain('linkedLaneGuidance');
      expect(nativeModule).toContain('highwayExitLabel');
      expect(nativeModule).toContain('updateIncidents');
      expect(mapView).toContain('polaris-incident-');
      // Polyline decoding must match src/utils/polyline.ts zig-zag, or the
      // route decodes to the wrong hemisphere while the camera follows GPS.
      expect(mapView).toContain('(dLat & 1) != 0 ? ~(dLat >> 1) : (dLat >> 1)');
      expect(mapView).not.toContain('~(dLat >> 1) ^');
    }
  });

  it('starts the CarPlay template without waiting for the RN module to attach', () => {
    // Tapping the home-screen app icon must open the map even on a cold
    // launch, when no phone window scene (and so no React Native module)
    // exists yet. Activation was previously gated on `instance != nil`, which
    // left the icon unresponsive.
    for (const root of ['plugins/native/PolarisMaps', 'ios/PolarisMaps']) {
      const nativeModule = readRepoFile(`${root}/PolarisCarPlay.swift`);
      expect(nativeModule).not.toContain(
        'guard instance != nil, pendingInterfaceController != nil',
      );
      expect(nativeModule).toContain(
        'guard pendingInterfaceController != nil, pendingWindow != nil',
      );
      expect(nativeModule).toContain('Self.attachPendingSceneIfNeeded()');
    }
  });
});
