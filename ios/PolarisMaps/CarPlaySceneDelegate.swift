import UIKit
import CarPlay

/// Dedicated scene delegate for the CarPlay window.
/// iOS instantiates this automatically when CarPlay connects, based on
/// the UIApplicationSceneManifest configuration in Info.plist.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

  var interfaceController: CPInterfaceController?

  // MARK: - CPTemplateApplicationSceneDelegate

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    self.interfaceController = interfaceController
    PolarisCarPlay.shared?.didConnect(interfaceController: interfaceController, window: window)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    PolarisCarPlay.shared?.didDisconnect(interfaceController: interfaceController)
    self.interfaceController = nil
  }
}
