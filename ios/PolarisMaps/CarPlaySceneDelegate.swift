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
}
