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

    print("[SceneDelegate] willConnectTo scene")
    NSLog("[SceneDelegate] willConnectTo scene")

    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      print("[SceneDelegate] missing appDelegate or factory")
      NSLog("[SceneDelegate] missing appDelegate or factory")
      window.makeKeyAndVisible()
      return
    }

    print("[SceneDelegate] starting React Native")
    NSLog("[SceneDelegate] starting React Native")
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: [:]
    )
  }
}
