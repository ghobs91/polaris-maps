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
    PolarisCarPlay.sceneDidConnect(interfaceController: interfaceController, window: window)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController
  ) {
    PolarisCarPlay.sceneDidDisconnect(interfaceController: interfaceController)
  }

  /// Covers a cold launch from the CarPlay home screen: re-assert the map and
  /// retry its built-in style so the screen isn't blank until the phone app is
  /// opened and pushes the phone style.
  func sceneDidBecomeActive(_ scene: UIScene) {
    PolarisCarPlay.sceneDidBecomeActive()
  }
}

/// CarPlay Dashboard widget (iOS 13.4+). Provides the two shortcut buttons the
/// widget shows; tapping one asks JS to preview navigation to that favorite.
class CarPlayDashboardSceneDelegate: UIResponder, CPTemplateApplicationDashboardSceneDelegate {

  func templateApplicationDashboardScene(
    _ templateApplicationDashboardScene: CPTemplateApplicationDashboardScene,
    didConnect dashboardController: CPDashboardController,
    to window: UIWindow
  ) {
    // Render the live Polaris map into the Dashboard window so the split view
    // (map + upcoming maneuver + Now Playing) mirrors Apple/Google Maps.
    PolarisCarPlay.dashboardSceneDidConnect(window: window)
    let home = CPDashboardButton(
      titleVariants: ["Home"],
      subtitleVariants: ["Navigate home"],
      image: UIImage(systemName: "house.fill") ?? UIImage()
    ) { _ in
      PolarisCarPlay.emitDashboardFavorite("home")
    }
    let work = CPDashboardButton(
      titleVariants: ["Work"],
      subtitleVariants: ["Navigate to work"],
      image: UIImage(systemName: "briefcase.fill") ?? UIImage()
    ) { _ in
      PolarisCarPlay.emitDashboardFavorite("work")
    }
    dashboardController.shortcutButtons = [home, work]
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
