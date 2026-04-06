import Foundation

/// Native module bridging CarPlay state between JavaScript and the CarPlay controller.
/// Emits events when CarPlay connects/disconnects and when the user interacts with CarPlay UI.
/// Receives navigation state updates, search results, and commands from JavaScript.
@objc(PolarisCarPlay)
class PolarisCarPlay: RCTEventEmitter {

  private static var sharedInstance: PolarisCarPlay?
  private var hasListeners = false

  override init() {
    super.init()
    Self.sharedInstance = self
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String] {
    return [
      "carPlayConnected",
      "carPlayDisconnected",
      "searchQuery",
      "searchResultSelected",
      "navigationEndRequested",
    ]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  /// Thread-safe event emission from any context (e.g. CarPlaySceneDelegate).
  static func emitCarPlayEvent(_ name: String, body: [String: Any]) {
    guard let instance = sharedInstance, instance.hasListeners else { return }
    instance.sendEvent(withName: name, body: body)
  }

  // MARK: - Methods callable from JavaScript

  /// Update the CarPlay navigation session with the current maneuver and ETA.
  @objc
  func updateNavigation(_ data: NSDictionary) {
    DispatchQueue.main.async {
      let controller = CarPlayController.shared; guard controller.interfaceController != nil else { return }

      let isNavigating = data["isNavigating"] as? Bool ?? false
      if !isNavigating {
        controller.endNavigationSession()
        return
      }

      // Build maneuver data for the next turns
      let maneuverType = data["maneuverType"] as? String ?? "continue"
      let instruction = data["instruction"] as? String ?? ""
      let distanceToTurn = data["distanceToTurnMeters"] as? Double ?? 0
      let durationToTurn = data["durationToTurnSeconds"] as? Double ?? 0

      let currentManeuver: [String: Any] = [
        "instruction": instruction,
        "distanceMeters": distanceToTurn,
        "durationSeconds": durationToTurn,
        "symbolName": CarPlayController.symbolName(for: maneuverType),
      ]

      // Optional next maneuver
      var maneuvers = [currentManeuver]
      if let nextInstruction = data["nextInstruction"] as? String,
         let nextType = data["nextManeuverType"] as? String
      {
        maneuvers.append([
          "instruction": nextInstruction,
          "distanceMeters": data["nextDistanceMeters"] as? Double ?? 0,
          "durationSeconds": data["nextDurationSeconds"] as? Double ?? 0,
          "symbolName": CarPlayController.symbolName(for: nextType),
        ])
      }

      controller.updateManeuvers(maneuvers)

      let etaSeconds = data["etaSeconds"] as? Double ?? 0
      let remainingMeters = data["remainingDistanceMeters"] as? Double ?? 0
      controller.updateTravelEstimates(distanceMeters: remainingMeters, timeSeconds: etaSeconds)
    }
  }

  /// Start a CarPlay navigation session with route geometry and maneuvers.
  @objc
  func startNavigation(_ data: NSDictionary) {
    DispatchQueue.main.async {
      let cp = CarPlayController.shared
      guard cp.interfaceController != nil,
            let destName = data["destinationName"] as? String,
            let destLat = data["destinationLat"] as? Double,
            let destLng = data["destinationLng"] as? Double,
            let polyline = data["encodedPolyline"] as? String,
            let maneuverArray = data["maneuvers"] as? [[String: Any]]
      else { return }

      let enriched = maneuverArray.map { m -> [String: Any] in
        var copy = m
        if let type = m["maneuverType"] as? String {
          copy["symbolName"] = CarPlayController.symbolName(for: type)
        }
        return copy
      }

      cp.startNavigationSession(
        destinationName: destName,
        destinationLat: destLat,
        destinationLng: destLng,
        encodedPolyline: polyline,
        maneuvers: enriched
      )
    }
  }

  /// End the current CarPlay navigation session.
  @objc
  func endNavigation() {
    DispatchQueue.main.async {
      CarPlayController.shared.endNavigationSession()
    }
  }

  /// Push search results from JS to the CarPlay search template.
  @objc
  func pushSearchResults(_ results: NSArray) {
    DispatchQueue.main.async {
      guard let arr = results as? [[String: Any]] else { return }
      CarPlayController.shared.pushSearchResults(arr)
    }
  }

  /// Update the CarPlay map center when not navigating.
  @objc
  func updateMapCenter(_ lat: Double, lng: Double, heading: Double) {
    DispatchQueue.main.async {
      CarPlayController.shared.updateMapCenter(latitude: lat, longitude: lng, heading: heading)
    }
  }

  /// Check whether CarPlay is currently connected.
  @objc
  func isConnected(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(CarPlayController.shared.interfaceController != nil)
  }
}
