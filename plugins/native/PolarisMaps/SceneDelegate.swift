import UIKit
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    window.backgroundColor = .systemRed
    self.window = window

    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      window.makeKeyAndVisible()
      return
    }

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: [:]
    )
  }
}
