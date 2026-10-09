internal import Expo
import AVFAudio
import CarPlay
import React
import ReactAppDependencyProvider
import UIKit

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// Guards the one-shot React Native startup (see `startReactNativeIfNeeded`).
  private var hasStartedReactNative = false
  /// The single React Native root view controller. Retained here so the React
  /// tree — and the CarPlay manager it initialises — stays alive when React
  /// Native is started by the CarPlay scene with no phone window to hold it.
  private(set) var reactNativeRootViewController: UIViewController?

  /// Starts React Native exactly once and returns its root view controller.
  ///
  /// A CarPlay cold launch — the driver connects to the car with the phone app
  /// closed — creates only the CarPlay scene: the phone window scene never
  /// connects, so starting React Native only from `SceneDelegate` left it (and
  /// every JS-backed CarPlay feature: search, routing, favorites) dead until
  /// the phone app was opened. Whichever scene connects first now starts React
  /// Native. `window` is the phone scene's window when the phone UI launches
  /// it, and nil when the CarPlay scene launches it (there is no phone window
  /// yet). The root view controller is retained here, so a headless start still
  /// runs the app and a later phone scene adopts it instead of starting a
  /// second bridge.
  @discardableResult
  func startReactNativeIfNeeded(in window: UIWindow?) -> UIViewController? {
    guard let factory = reactNativeFactory else { return nil }

    if hasStartedReactNative {
      // CarPlay cold-launched React Native before the phone UI existed: adopt
      // the retained root view controller into the phone window now.
      if let window = window, let rootViewController = reactNativeRootViewController,
        window.rootViewController !== rootViewController
      {
        window.rootViewController = rootViewController
        window.makeKeyAndVisible()
      }
      return reactNativeRootViewController
    }

    hasStartedReactNative = true

    // Mirrors `RCTReactNativeFactory.startReactNative` so the Expo root view
    // (through `EXReactRootViewFactory` and the Expo react delegate) is created
    // exactly as before — but without requiring a window: with a nil window the
    // root view controller is retained here instead.
    let rootView = factory.rootViewFactory.view(withModuleName: "main")
    let rootViewController = reactNativeDelegate?.createRootViewController() ?? UIViewController()
    reactNativeDelegate?.setRootView(rootView, toRootViewController: rootViewController)
    reactNativeRootViewController = rootViewController

    if let window = window {
      window.rootViewController = rootViewController
      window.makeKeyAndVisible()
    }
    return rootViewController
  }

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    configureNavigationAudioSession()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // The window is created and React Native is started by whichever scene
    // connects first — the phone `SceneDelegate`, or the CarPlay scene on a
    // cold launch from the car (see `startReactNativeIfNeeded`) — under the
    // scene-based lifecycle required by the iOS 27 SDK.
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /// Configures the shared audio session for spoken turn-by-turn guidance.
  ///
  /// expo-speech (`AVSpeechSynthesizer`) never sets a category, so iOS keeps the
  /// default `soloAmbient`: prompts are muted by the ring/silent switch and stop
  /// when the app is backgrounded or the screen is locked — even though the app
  /// declares the `audio` UIBackgroundMode. `.playback` + `.voicePrompt` with
  /// ducking is the category Apple recommends for navigation prompts, so
  /// guidance keeps speaking while locked and other audio is only ducked while
  /// a prompt plays. Setting the category (not activating the session) leaves
  /// music untouched until the synthesizer actually speaks.
  private func configureNavigationAudioSession() {
    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .voicePrompt,
        options: [.duckOthers, .mixWithOthers]
      )
    } catch {
      // Non-fatal: guidance still works in the foreground with the default
      // session, so a failure here must never block app launch.
    }
  }

  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)

    // Route CarPlay template application scenes to their own delegate; all
    // other roles (the phone UI) keep the React-hosting SceneDelegate.
    // sceneClass must be CPTemplateApplicationScene or UIKit never creates a
    // CarPlay template scene and the app won't appear in CarPlay.
    if connectingSceneSession.role.rawValue == "CPTemplateApplicationSceneSessionRoleApplication" {
      configuration.sceneClass = CPTemplateApplicationScene.self
      configuration.delegateClass = CarPlaySceneDelegate.self
    } else if connectingSceneSession.role.rawValue
      == "CPTemplateApplicationDashboardSceneSessionRoleApplication"
    {
      configuration.sceneClass = CPTemplateApplicationDashboardScene.self
      configuration.delegateClass = CarPlayDashboardSceneDelegate.self
    } else if connectingSceneSession.role.rawValue
      == "CPTemplateApplicationInstrumentClusterSceneSessionRoleApplication"
    {
      configuration.sceneClass = CPTemplateApplicationInstrumentClusterScene.self
      configuration.delegateClass = CarPlayInstrumentClusterSceneDelegate.self
    } else {
      configuration.delegateClass = SceneDelegate.self
    }

    return configuration
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

/**
 Scene-based lifecycle delegate. Defined in this file (rather than a separate
 SceneDelegate.swift) so it compiles without adding a new file to the
 generated Xcode project.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // Mirror the window onto the app delegate so code that reads
    // `UIApplication.shared.delegate?.window` keeps working (e.g. expo-system-ui).
    appDelegate.window = window

    // Starts React Native, or adopts the instance the CarPlay scene already
    // started when the app was cold-launched from the car with no phone window.
    appDelegate.startReactNativeIfNeeded(in: window)

    // Deep links / universal links delivered at launch.
    connectionOptions.urlContexts.forEach { urlContext in
      _ = RCTLinkingManager.application(UIApplication.shared, open: urlContext.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { urlContext in
      _ = RCTLinkingManager.application(UIApplication.shared, open: urlContext.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
