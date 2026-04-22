import Foundation
import CarPlay
import React

/// Native module that bridges CarPlay template interactions to React Native.
/// Implements CPTemplateApplicationSceneDelegate for CarPlay lifecycle and
/// exposes methods for the JS-side carPlayManager to push navigation/search state.
@objc(PolarisCarPlay)
final class PolarisCarPlay: RCTEventEmitter {

  // MARK: - Singleton

  /// Shared instance set when RN creates the module. Used by the scene delegate
  /// to forward CarPlay lifecycle events.
  static weak var shared: PolarisCarPlay?
  private static var pendingInterfaceController: CPInterfaceController?
  private static var isSceneConnected = false

  // MARK: - State

  private var carPlayConnected = false
  private var interfaceController: CPInterfaceController?
  private var mapTemplate: CPMapTemplate?
  private var navigationSession: CPNavigationSession?
  private var searchTemplate: CPSearchTemplate?
  private var currentTrip: CPTrip?
  private var pendingSearchCompletion: (([CPListItem]) -> Void)?

  // MARK: - RCTEventEmitter overrides

  override init() {
    super.init()
    PolarisCarPlay.shared = self
    attachPendingSceneIfNeeded()
  }

  override static func moduleName() -> String! {
    return "PolarisCarPlay"
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return [
      "carPlayConnected",
      "carPlayDisconnected",
      "searchQuery",
      "searchResultSelected",
    ]
  }

  static func sceneDidConnect(interfaceController: CPInterfaceController, window: CPWindow) {
    pendingInterfaceController = interfaceController
    isSceneConnected = true
    shared?.didConnect(interfaceController: interfaceController)
  }

  static func sceneDidDisconnect(interfaceController: CPInterfaceController) {
    pendingInterfaceController = nil
    isSceneConnected = false
    shared?.didDisconnect(interfaceController: interfaceController)
  }

  // MARK: - Scene delegate callbacks (called by CarPlaySceneDelegate)

  func didConnect(interfaceController: CPInterfaceController) {
    Self.pendingInterfaceController = interfaceController
    Self.isSceneConnected = true
    self.interfaceController = interfaceController
    self.carPlayConnected = true

    // Build the map template with search and navigation buttons
    let mapTemplate = CPMapTemplate()
    mapTemplate.automaticallyHidesNavigationBar = false

    // Search bar button
    let searchButton = CPBarButton(title: "Search") { [weak self] _ in
      self?.presentSearch()
    }
    mapTemplate.leadingNavigationBarButtons = [searchButton]
    self.mapTemplate = mapTemplate

    interfaceController.setRootTemplate(mapTemplate, animated: true, completion: nil)

    sendEvent(withName: "carPlayConnected", body: nil)
  }

  func didDisconnect(interfaceController: CPInterfaceController) {
    endActiveNavigation()
    Self.pendingInterfaceController = nil
    Self.isSceneConnected = false
    pendingSearchCompletion?([])
    pendingSearchCompletion = nil
    self.interfaceController = nil
    self.mapTemplate = nil
    self.carPlayConnected = false

    sendEvent(withName: "carPlayDisconnected", body: nil)
  }

  // MARK: - Search

  private func presentSearch() {
    let searchTemplate = CPSearchTemplate()
    searchTemplate.delegate = self
    pendingSearchCompletion = nil
    self.searchTemplate = searchTemplate

    interfaceController?.pushTemplate(searchTemplate, animated: true, completion: nil)
  }

  // MARK: - Exported methods

  @objc func updateNavigation(_ data: NSDictionary) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }

      let isNavigating = data["isNavigating"] as? Bool ?? false
      guard isNavigating else {
        // Nothing to update when not navigating
        return
      }

      guard let session = self.navigationSession else { return }

      let instruction = data["instruction"] as? String ?? ""
      let maneuverType = data["maneuverType"] as? String ?? "continue"
      let distanceToTurn = data["distanceToTurnMeters"] as? Double ?? 0
      let etaSeconds = data["etaSeconds"] as? Double ?? 0
      let remainingDistance = data["remainingDistanceMeters"] as? Double ?? 0

      // Update the current maneuver
      let maneuver = CPManeuver()
      maneuver.instructionVariants = [instruction]
      maneuver.initialTravelEstimates = CPTravelEstimates(
        distanceRemaining: Measurement(value: distanceToTurn, unit: .meters),
        timeRemaining: 0
      )
      Self.applyManeuverSymbol(maneuver, type: maneuverType)

      // Update overall trip estimates
      let estimates = CPTravelEstimates(
        distanceRemaining: Measurement(value: remainingDistance, unit: .meters),
        timeRemaining: etaSeconds
      )
      session.updateTravelEstimates(estimates, forManeuver: maneuver)

      session.upcomingManeuvers = [maneuver]

      // Add next maneuver if available
      if let nextInstruction = data["nextInstruction"] as? String,
         let nextType = data["nextManeuverType"] as? String {
        let nextManeuver = CPManeuver()
        nextManeuver.instructionVariants = [nextInstruction]
        if let nextDist = data["nextDistanceMeters"] as? Double {
          nextManeuver.initialTravelEstimates = CPTravelEstimates(
            distanceRemaining: Measurement(value: nextDist, unit: .meters),
            timeRemaining: 0
          )
        }
        Self.applyManeuverSymbol(nextManeuver, type: nextType)
        session.upcomingManeuvers = [maneuver, nextManeuver]
      }
    }
  }

  @objc func startNavigation(_ data: NSDictionary) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let mapTemplate = self.mapTemplate else { return }

      let destName = data["destinationName"] as? String ?? "Destination"
      let destLat = data["destinationLat"] as? Double ?? 0
      let destLng = data["destinationLng"] as? Double ?? 0
      let maneuverDicts = data["maneuvers"] as? [[String: Any]] ?? []

      // End any existing navigation
      self.endActiveNavigation()

      // Build destination
      let destCoord = CLLocationCoordinate2D(latitude: destLat, longitude: destLng)
      let destMapItem = MKMapItem(placemark: MKPlacemark(coordinate: destCoord))
      destMapItem.name = destName

      // Build maneuvers
      var cpManeuvers: [CPManeuver] = []
      for dict in maneuverDicts {
        let maneuver = CPManeuver()
        let instruction = dict["instruction"] as? String ?? ""
        maneuver.instructionVariants = [instruction]

        let type = dict["maneuverType"] as? String ?? "continue"
        Self.applyManeuverSymbol(maneuver, type: type)

        if let dist = dict["distanceMeters"] as? Double {
          maneuver.initialTravelEstimates = CPTravelEstimates(
            distanceRemaining: Measurement(value: dist, unit: .meters),
            timeRemaining: 0
          )
        }
        cpManeuvers.append(maneuver)
      }

      // Build route & trip
      let routeChoice = CPRouteChoice(
        summaryVariants: [destName],
        additionalInformationVariants: [],
        selectionSummaryVariants: []
      )

      let originMapItem = MKMapItem.forCurrentLocation()
      let trip = CPTrip(origin: originMapItem, destination: destMapItem, routeChoices: [routeChoice])
      self.currentTrip = trip

      // Start navigation session
      let session = mapTemplate.startNavigationSession(for: trip)
      session.upcomingManeuvers = cpManeuvers
      self.navigationSession = session

      // Dismiss search if presented
      if self.searchTemplate != nil {
        self.interfaceController?.popToRootTemplate(animated: true, completion: nil)
        self.searchTemplate = nil
      }
    }
  }

  @objc func endNavigation() {
    DispatchQueue.main.async { [weak self] in
      self?.endActiveNavigation()
    }
  }

  @objc func pushSearchResults(_ results: NSArray) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let searchTemplate = self.searchTemplate else { return }

      var listItems: [CPListItem] = []
      for case let dict as NSDictionary in results {
        let name = dict["name"] as? String ?? ""
        let subtitle = dict["subtitle"] as? String ?? ""
        let lat = dict["lat"] as? Double ?? 0
        let lng = dict["lng"] as? Double ?? 0

        let item = CPListItem(text: name, detailText: subtitle)
        item.userInfo = ["name": name, "lat": lat, "lng": lng]
        item.handler = { [weak self] _, completion in
          self?.sendEvent(withName: "searchResultSelected", body: [
            "name": name,
            "lat": lat,
            "lng": lng,
          ])
          completion()
        }
        listItems.append(item)
      }

      self.pendingSearchCompletion?(listItems)
      self.pendingSearchCompletion = nil
    }
  }

  @objc func updateMapCenter(_ lat: Double, lng: Double, heading: Double) {
    // Reserved for future map camera updates on the CarPlay display
  }

  @objc func isConnected(_ resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.isSceneConnected)
  }

  // MARK: - Private helpers

  private func attachPendingSceneIfNeeded() {
    guard let interfaceController = Self.pendingInterfaceController else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self = self,
            self.interfaceController == nil,
            Self.isSceneConnected,
            Self.pendingInterfaceController === interfaceController else {
        return
      }

      self.didConnect(interfaceController: interfaceController)
    }
  }

  private func endActiveNavigation() {
    navigationSession?.finishTrip()
    navigationSession = nil
    currentTrip = nil
  }

  /// Maps maneuver type strings from Valhalla to SF Symbol names for CarPlay.
  private static func applyManeuverSymbol(_ maneuver: CPManeuver, type: String) {
    let symbolName: String
    switch type {
    case "start":              symbolName = "location.fill"
    case "destination":        symbolName = "mappin.circle.fill"
    case "turn_left":          symbolName = "arrow.turn.up.left"
    case "turn_right":         symbolName = "arrow.turn.up.right"
    case "sharp_left":         symbolName = "arrow.turn.up.left"
    case "sharp_right":        symbolName = "arrow.turn.up.right"
    case "slight_left":        symbolName = "arrow.up.left"
    case "slight_right":       symbolName = "arrow.up.right"
    case "continue":           symbolName = "arrow.up"
    case "u_turn":             symbolName = "arrow.uturn.down"
    case "merge_left":         symbolName = "arrow.merge"
    case "merge_right":        symbolName = "arrow.merge"
    case "enter_roundabout":   symbolName = "arrow.triangle.capsulepath"
    case "exit_roundabout":    symbolName = "arrow.turn.up.right"
    case "enter_highway":      symbolName = "road.lanes"
    case "exit_highway":       symbolName = "arrow.turn.up.right"
    case "ferry":              symbolName = "ferry.fill"
    case "name_change":        symbolName = "arrow.up"
    default:                   symbolName = "arrow.up"
    }

    if let image = UIImage(systemName: symbolName) {
      maneuver.symbolImage = image
    }
  }
}

// MARK: - CPSearchTemplateDelegate

extension PolarisCarPlay: CPSearchTemplateDelegate {
  func searchTemplate(_ searchTemplate: CPSearchTemplate,
                      updatedSearchText searchText: String,
                      completionHandler: @escaping ([CPListItem]) -> Void) {
    pendingSearchCompletion?([])
    pendingSearchCompletion = completionHandler

    // Forward search to JS side; results come back via pushSearchResults
    sendEvent(withName: "searchQuery", body: ["query": searchText])
  }

  func searchTemplate(_ searchTemplate: CPSearchTemplate,
                      selectedResult item: CPListItem,
                      completionHandler: @escaping () -> Void) {
    // Handled by the CPListItem.handler set in pushSearchResults
    completionHandler()
  }
}
