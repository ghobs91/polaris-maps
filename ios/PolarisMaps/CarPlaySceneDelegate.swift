import Foundation
import CarPlay
import UIKit

/// Delegate for the CarPlay template application scene. Hands the connected
/// interface controller and window to the `PolarisCarPlay` module, which owns
/// template construction and scene-state buffering.
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    // A cold launch from the CarPlay home screen creates only this scene: the
    // phone window scene never connects, so this is the only chance to start
    // React Native. Without it the native template renders, but every JS-backed
    // feature (search, routing, favorites) stays dead until the phone app is
    // opened. No phone window exists yet, so start it headlessly.
    (UIApplication.shared.delegate as? AppDelegate)?.startReactNativeIfNeeded(in: nil)
    PolarisCarPlay.sceneDidConnect(interfaceController: interfaceController, window: window)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController
  ) {
    PolarisCarPlay.sceneDidDisconnect(interfaceController: interfaceController)
  }

  /// Navigation apps receive the window variant of the disconnect callback.
  /// UIKit only calls the variant the delegate implements, so implementing both
  /// guarantees the app tears its CarPlay state down on every OS version.
  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    PolarisCarPlay.sceneDidDisconnect(interfaceController: interfaceController)
  }

  /// Covers a cold launch from the CarPlay home screen: re-assert the map and
  /// retry its built-in style so the screen isn't blank until the phone app is
  /// opened and pushes the phone style.
  func sceneDidBecomeActive(_ scene: UIScene) {
    PolarisCarPlay.sceneDidBecomeActive()
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    PolarisCarPlay.sceneDidBecomeActive()
  }
}

/// CarPlay Dashboard widget (iOS 13.4+). Renders the live Polaris map and lets
/// JS supply the shortcut buttons (Home / Work / first custom place) from the
/// app's favorites; tapping one starts navigation to that place.
class CarPlayDashboardSceneDelegate: UIResponder, CPTemplateApplicationDashboardSceneDelegate {

  func templateApplicationDashboardScene(
    _ templateApplicationDashboardScene: CPTemplateApplicationDashboardScene,
    didConnect dashboardController: CPDashboardController,
    to window: UIWindow
  ) {
    // The Dashboard scene can be the only CarPlay scene attached; start React
    // Native here too so its JS-driven shortcut buttons work on a cold launch.
    (UIApplication.shared.delegate as? AppDelegate)?.startReactNativeIfNeeded(in: nil)
    // Render the live Polaris map into the Dashboard window so the split view
    // (map + upcoming maneuver + Now Playing) mirrors Apple/Google Maps. The
    // controller receives the favorite shortcut buttons from JS.
    PolarisCarPlay.dashboardSceneDidConnect(
      window: window, dashboardController: dashboardController)
  }

  func templateApplicationDashboardScene(
    _ templateApplicationDashboardScene: CPTemplateApplicationDashboardScene,
    didDisconnect dashboardController: CPDashboardController,
    from window: UIWindow
  ) {
    PolarisCarPlay.dashboardSceneDidDisconnect()
  }
}

/// CarPlay instrument cluster (iOS 15.4+). The cluster mirrors the active
/// navigation session's maneuvers; the app only supplies the idle caption.
class CarPlayInstrumentClusterSceneDelegate: UIResponder,
  CPTemplateApplicationInstrumentClusterSceneDelegate
{

  func templateApplicationInstrumentClusterScene(
    _ templateApplicationInstrumentClusterScene: CPTemplateApplicationInstrumentClusterScene,
    didConnect instrumentClusterController: CPInstrumentClusterController
  ) {
    instrumentClusterController.inactiveDescriptionVariants = ["Polaris Maps"]
  }

  func templateApplicationInstrumentClusterScene(
    _ templateApplicationInstrumentClusterScene: CPTemplateApplicationInstrumentClusterScene,
    didDisconnect instrumentClusterController: CPInstrumentClusterController
  ) {
  }

  func contentStyleDidChange(_ contentStyle: UIUserInterfaceStyle) {
  }
}
