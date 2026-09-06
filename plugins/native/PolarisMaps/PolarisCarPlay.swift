import Foundation
import React
import CarPlay
import MapKit
import UIKit

/// Native bridge exposing CarPlay to the JS `carPlayManager`.
///
/// The CarPlay scene can connect before the React Native bridge attaches this
/// module, so scene state is buffered in static storage and replayed via
/// `attachPendingSceneIfNeeded()` once an instance exists.
@objc(PolarisCarPlay)
class PolarisCarPlay: RCTEventEmitter {

  // MARK: - Scene state buffering

  private static var pendingInterfaceController: CPInterfaceController?
  private static var pendingWindow: CPWindow?
  private static var isSceneConnected = false
  private static weak var instance: PolarisCarPlay?

  private static let mapTemplateManager = CarPlayTemplateManager()

  override init() {
    super.init()
    Self.instance = self
    Self.attachPendingSceneIfNeeded()
  }

  private static func emit(_ event: String, _ body: Any) {
    instance?.sendEvent(withName: event, body: body)
  }

  /// Publishes a buffered scene connection once the RN-managed instance exists.
  /// Always activates on the main thread: `init` and `startObserving` run on
  /// RN bridge queues, and UIKit/CarPlay calls made off-main raise and abort
  /// the process (SIGABRT on CarPlay connect).
  static func attachPendingSceneIfNeeded() {
    guard instance != nil, pendingInterfaceController != nil else { return }
    guard Thread.isMainThread else {
      DispatchQueue.main.async { Self.attachPendingSceneIfNeeded() }
      return
    }
    mapTemplateManager.activate(
      interfaceController: pendingInterfaceController!, window: pendingWindow!)
    emit("carPlayConnected", ["connected": true])
  }

  // MARK: - Scene lifecycle (called by CarPlaySceneDelegate)

  static func sceneDidConnect(interfaceController: CPInterfaceController, window: CPWindow) {
    pendingInterfaceController = interfaceController
    pendingWindow = window
    isSceneConnected = true
    DispatchQueue.main.async { Self.attachPendingSceneIfNeeded() }
  }

  static func sceneDidDisconnect(interfaceController: CPInterfaceController) {
    DispatchQueue.main.async {
      mapTemplateManager.deactivate()
      pendingInterfaceController = nil
      pendingWindow = nil
      isSceneConnected = false
      emit("carPlayDisconnected", ["connected": false])
    }
  }

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["carPlayConnected", "carPlayDisconnected", "searchQuery", "searchResultSelected"]
  }

  override func startObserving() {
    Self.attachPendingSceneIfNeeded()
  }

  // MARK: - JS API (mirrors NativePolarisCarPlay.ts)

  @objc func updateNavigation(_ data: NSDictionary) {
    let payload = CarPlayNavigationUpdate(from: data)
    DispatchQueue.main.async { Self.mapTemplateManager.applyNavigationUpdate(payload) }
  }

  @objc func startNavigation(_ data: NSDictionary) {
    DispatchQueue.main.async { Self.mapTemplateManager.startNavigation(with: data) }
  }

  @objc func endNavigation() {
    DispatchQueue.main.async { Self.mapTemplateManager.endNavigation() }
  }

  @objc func pushSearchResults(_ results: NSArray) {
    let items = results.compactMap { element -> CarPlaySearchItem? in
      guard let dict = element as? NSDictionary,
        let name = dict["name"] as? String,
        let lat = (dict["lat"] as? NSNumber)?.doubleValue,
        let lng = (dict["lng"] as? NSNumber)?.doubleValue
      else { return nil }
      return CarPlaySearchItem(
        name: name,
        subtitle: dict["subtitle"] as? String ?? "",
        lat: lat,
        lng: lng
      )
    }
    DispatchQueue.main.async { Self.mapTemplateManager.replaceSearchResults(items) }
  }

  @objc func updateMapCenter(_ lat: Double, lng: Double, heading: Double) {
    DispatchQueue.main.async { Self.mapTemplateManager.updateCamera(lat: lat, lng: lng, heading: heading) }
  }

  @objc func updateRouteTraffic(_ ranges: NSArray) {
    let parsed = ranges.compactMap { element -> RouteTrafficRange? in
      guard let dict = element as? NSDictionary,
        let hex = dict["color"] as? String,
        let from = (dict["from"] as? NSNumber)?.intValue,
        let to = (dict["to"] as? NSNumber)?.intValue,
        let color = UIColor(hexString: hex)
      else { return nil }
      return RouteTrafficRange(color: color, from: from, to: to)
    }
    DispatchQueue.main.async { Self.mapTemplateManager.applyRouteTraffic(parsed) }
  }

  @objc func showReroutingAlert() {
    DispatchQueue.main.async { Self.mapTemplateManager.showReroutingAlert() }
  }

  @objc func hideNavigationAlert() {
    DispatchQueue.main.async { Self.mapTemplateManager.hideNavigationAlert() }
  }

  @objc
  func isConnected(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Self.isSceneConnected)
  }
}

// MARK: - Payload models

struct CarPlaySearchItem {
  let name: String
  let subtitle: String
  let lat: Double
  let lng: Double
}

struct CarPlayLaneInfo {
  let laneCount: Int
  let activeLanes: [Int]
  let laneDirections: [String]

  init?(from data: NSDictionary) {
    guard
      let count = (data["laneCount"] as? NSNumber)?.intValue,
      let directions = data["laneDirections"] as? NSArray
    else { return nil }
    laneCount = count
    activeLanes = Set((data["activeLanes"] as? NSArray ?? []).compactMap { ($0 as? NSNumber)?.intValue }).sorted()
    laneDirections = directions.compactMap { $0 as? String }
  }

  var isUsable: Bool { laneCount >= 2 && laneDirections.count >= 2 }
}

struct CarPlayNavigationUpdate {
  let isNavigating: Bool
  let instruction: String
  let displayInstruction: String
  let maneuverType: String
  let distanceToTurnMeters: Double
  let durationToTurnSeconds: Double
  let etaSeconds: Double
  let remainingDistanceMeters: Double
  let nextInstruction: String?
  let nextManeuverType: String?
  let nextDistanceMeters: Double
  let nextStreetNames: [String]
  let speedLimitValue: Double?
  let speedLimitUnit: String
  let laneGuidance: CarPlayLaneInfo?
  let isRerouting: Bool

  init(from data: NSDictionary) {
    isNavigating = (data["isNavigating"] as? NSNumber)?.boolValue ?? false
    instruction = data["instruction"] as? String ?? ""
    // Phone-banner text (verbal-first); fall back to the raw instruction.
    let display = data["displayInstruction"] as? String ?? ""
    displayInstruction = display.isEmpty ? instruction : display
    maneuverType = data["maneuverType"] as? String ?? ""
    distanceToTurnMeters = (data["distanceToTurnMeters"] as? NSNumber)?.doubleValue ?? 0
    durationToTurnSeconds = (data["durationToTurnSeconds"] as? NSNumber)?.doubleValue ?? 0
    etaSeconds = (data["etaSeconds"] as? NSNumber)?.doubleValue ?? 0
    remainingDistanceMeters = (data["remainingDistanceMeters"] as? NSNumber)?.doubleValue ?? 0
    nextInstruction = data["nextInstruction"] as? String
    nextManeuverType = data["nextManeuverType"] as? String
    nextDistanceMeters = (data["nextDistanceMeters"] as? NSNumber)?.doubleValue ?? 0
    nextStreetNames = (data["nextStreetNames"] as? NSArray ?? []).compactMap { $0 as? String }
    // Preferred unit-aware fields; falls back to the legacy mph field.
    let rawLimit =
      (data["speedLimitValue"] as? NSNumber)?.doubleValue
      ?? (data["speedLimitMph"] as? NSNumber)?.doubleValue ?? 0
    if rawLimit > 0 {
      speedLimitValue = rawLimit
      let unit = data["speedLimitUnit"] as? String ?? "mph"
      speedLimitUnit = unit == "km/h" ? "km/h" : "mph"
    } else {
      speedLimitValue = nil
      speedLimitUnit = "mph"
    }
    if let lanes = data["laneGuidance"] as? NSDictionary {
      laneGuidance = CarPlayLaneInfo(from: lanes)
    } else {
      laneGuidance = nil
    }
    isRerouting = (data["isRerouting"] as? NSNumber)?.boolValue ?? false
  }

  /// Identity of the maneuver pair. Distance/ETA changes must NOT create new
  /// maneuver objects — they go through `updateEstimates(for:)` instead, or
  /// CarPlay re-renders the guidance card on every update (visible flicker).
  var signature: String {
    "\(maneuverType)|\(displayInstruction)|\(nextManeuverType ?? "")|\(nextInstruction ?? "")|\(laneGuidance != nil)"
  }
}

struct CarPlayManeuverStep {
  let instruction: String
  let maneuverType: String
  let distanceMeters: Double
  let durationSeconds: Double
}

/// One traffic-colored run over the route shape. `from`/`to` are inclusive
/// indices into the precision-6 decoded polyline, matching the JS builder.
struct RouteTrafficRange {
  let color: UIColor
  let from: Int
  let to: Int
}

extension UIColor {
  /// Parses `#RRGGBB` / `RRGGBB` (and `#RGB` shorthand). Returns nil for junk.
  convenience init?(hexString: String) {
    var hex = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    if hex.count == 3 {
      hex = hex.map { "\($0)\($0)" }.joined()
    }
    guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
    self.init(
      red: CGFloat((value & 0xFF0000) >> 16) / 255,
      green: CGFloat((value & 0x00FF00) >> 8) / 255,
      blue: CGFloat(value & 0x0000FF) / 255,
      alpha: 1
    )
  }
}

struct CarPlayStartNavigationPayload {
  let destinationName: String
  let destinationLat: Double
  let destinationLng: Double
  let encodedPolyline: String
  let maneuvers: [CarPlayManeuverStep]

  init?(from data: NSDictionary) {
    guard
      let name = data["destinationName"] as? String,
      let lat = (data["destinationLat"] as? NSNumber)?.doubleValue,
      let lng = (data["destinationLng"] as? NSNumber)?.doubleValue,
      let polyline = data["encodedPolyline"] as? String
    else { return nil }
    destinationName = name
    destinationLat = lat
    destinationLng = lng
    encodedPolyline = polyline
    var steps: [CarPlayManeuverStep] = []
    if let list = data["maneuvers"] as? NSArray {
      for entry in list {
        guard let m = entry as? NSDictionary,
          let instruction = m["instruction"] as? String
        else { continue }
        steps.append(
          CarPlayManeuverStep(
            instruction: instruction,
            maneuverType: m["maneuverType"] as? String ?? "",
            distanceMeters: (m["distanceMeters"] as? NSNumber)?.doubleValue ?? 0,
            durationSeconds: (m["durationSeconds"] as? NSNumber)?.doubleValue ?? 0
          ))
      }
    }
    maneuvers = steps
  }
}

// MARK: - Templates and navigation session management

/// Owns the CPMapTemplate / CPSearchTemplate and the active navigation
/// session. All methods must run on the main thread.
final class CarPlayTemplateManager: NSObject, CPSearchTemplateDelegate,
  CPMapTemplateDelegate, CPSessionConfigurationDelegate
{
  private var interfaceController: CPInterfaceController?
  private var mapTemplate: CPMapTemplate?
  private var searchTemplate: CPSearchTemplate?
  private var sessionConfiguration: CPSessionConfiguration?

  private var navigationSession: CPNavigationSession?
  private var activeTrip: CPTrip?
  private var activePolyline = ""
  private var maneuverSignature = ""
  private var reroutingAlert: CPNavigationAlert?
  private var searchItems: [CarPlaySearchItem] = []
  private var activeSearchText = ""
  private var pendingSearchCompletion: (([CPListItem]) -> Void)?

  private lazy var mapViewHost = CarPlayMapViewHost()

  func activate(interfaceController: CPInterfaceController, window: CPWindow) {
    guard self.interfaceController == nil else { return }
    self.interfaceController = interfaceController

    mapViewHost.activate(in: window)

    let template = CPMapTemplate()
    template.mapDelegate = self
    template.mapButtons = makeMapButtons()
    mapTemplate = template

    let search = CPSearchTemplate()
    search.delegate = self
    searchTemplate = search

    sessionConfiguration = CPSessionConfiguration(delegate: self)

    interfaceController.setRootTemplate(template, animated: false, completion: nil)
  }

  func deactivate() {
    endNavigation()
    activeTrip = nil
    activePolyline = ""
    maneuverSignature = ""
    mapViewHost.deactivate()
    interfaceController = nil
    mapTemplate = nil
    searchTemplate = nil
    sessionConfiguration = nil
    searchItems = []
    activeSearchText = ""
    pendingSearchCompletion = nil
  }

  // MARK: Map buttons

  private func makeMapButtons() -> [CPMapButton] {
    return [
      makeMapButton(systemName: "location.fill") { [weak self] in self?.mapViewHost.recenter() },
      makeMapButton(systemName: "magnifyingglass") { [weak self] in self?.presentSearch() },
    ]
  }

  private func makeMapButton(systemName: String, handler: @escaping () -> Void) -> CPMapButton {
    let button = CPMapButton { _ in handler() }
    button.image = UIImage(systemName: systemName)
    return button
  }

  private func presentSearch() {
    guard let search = searchTemplate else { return }
    interfaceController?.pushTemplate(search, animated: true, completion: nil)
  }

  // MARK: Navigation

  func startNavigation(with data: NSDictionary) {
    guard
      let payload = CarPlayStartNavigationPayload(from: data),
      let template = mapTemplate
    else { return }

    // Ignore duplicate starts for the route already on screen. Restarting the
    // session tears down the guidance card and the route overlay, which reads
    // as a flashing banner with no route.
    if navigationSession != nil && payload.encodedPolyline == activePolyline {
      return
    }

    endNavigation()

    // A phone-side navigation session may connect before its first position
    // update reaches CarPlay. Use the route start instead of leaving the trip
    // origin at the map host's (0, 0) default.
    if mapViewHost.currentCoordinate.latitude == 0 && mapViewHost.currentCoordinate.longitude == 0,
      let firstCoordinate = PolylineDecoder.decode(payload.encodedPolyline).first {
      mapViewHost.currentCoordinate = firstCoordinate
    }

    let origin = MKMapItem(placemark: MKPlacemark(coordinate: mapViewHost.currentCoordinate))
    origin.name = "Current location"
    let destination = MKMapItem(
      placemark: MKPlacemark(
        coordinate: CLLocationCoordinate2D(latitude: payload.destinationLat, longitude: payload.destinationLng))
    )
    destination.name = payload.destinationName

    let totalDistance = payload.maneuvers.reduce(0) { $0 + $1.distanceMeters }
    let totalTime = totalDuration(payload)
    let summary = String(format: "%.1f km · %d min", totalDistance / 1000, Int(totalTime / 60))
    let routeChoice = CPRouteChoice(
      summaryVariants: [summary],
      additionalInformationVariants: [],
      selectionSummaryVariants: [payload.destinationName]
    )
    routeChoice.userInfo = payload.encodedPolyline

    let trip = CPTrip(origin: origin, destination: destination, routeChoices: [routeChoice])
    let destinationCoordinate = CLLocationCoordinate2D(
      latitude: payload.destinationLat, longitude: payload.destinationLng)

    mapViewHost.showRoute(encodedPolyline: payload.encodedPolyline, destination: destinationCoordinate)
    navigationSession = template.startNavigationSession(for: trip)
    activeTrip = trip
    activePolyline = payload.encodedPolyline

    // Publish overall trip estimates so the arrival pill shows a real ETA
    // instead of "now".
    let tripEstimates = CPTravelEstimates(
      distanceRemaining: Measurement(value: totalDistance, unit: UnitLength.meters),
      timeRemaining: totalTime
    )
    template.update(tripEstimates, for: trip)

    // Show the full maneuver list from the start — the current maneuver is
    // index 0, and per-update sync narrows it to the live pair.
    applyManeuvers(payload.maneuvers)
  }

  func applyNavigationUpdate(_ update: CarPlayNavigationUpdate) {
    guard let session = navigationSession, let template = mapTemplate else { return }
    if !update.isNavigating {
      endNavigation()
      return
    }

    // Steady-state path: the maneuver pair hasn't changed, so only refresh
    // numbers in place. Replacing `upcomingManeuvers` on every tick makes the
    // guidance card visibly flicker.
    if update.signature == maneuverSignature, let current = session.upcomingManeuvers.first {
      session.updateEstimates(
        travelEstimates(distanceMeters: update.distanceToTurnMeters, seconds: update.durationToTurnSeconds),
        for: current
      )
      if let trip = activeTrip {
        template.update(
          travelEstimates(distanceMeters: update.remainingDistanceMeters, seconds: update.etaSeconds),
          for: trip
        )
      }
      return
    }

    var upcoming: [CPManeuver] = []
    if !update.displayInstruction.isEmpty {
      upcoming.append(
        makeManeuver(
          instruction: update.displayInstruction,
          shortInstruction: update.instruction,
          maneuverType: update.maneuverType,
          distanceMeters: update.distanceToTurnMeters,
          durationSeconds: update.durationToTurnSeconds
        ))
    }
    if let next = update.nextInstruction, !next.isEmpty {
      // Lane guidance takes the second slot (Apple's recommended layout):
      // the lane strip renders symbol-only while the "Then" turn stays in
      // the instruction variants for other surfaces.
      let lanes = update.laneGuidance
      upcoming.append(
        makeManeuver(
          instruction: next,
          shortInstruction: update.nextStreetNames.first,
          maneuverType: update.nextManeuverType ?? "",
          distanceMeters: update.nextDistanceMeters,
          durationSeconds: 0,
          laneImage: lanes?.isUsable == true ? LaneStripImage.make(from: lanes!) : nil
        ))
    }
    guard !upcoming.isEmpty else { return }
    maneuverSignature = update.signature
    session.upcomingManeuvers = upcoming
    mapViewHost.showSpeedLimit(value: update.speedLimitValue, unit: update.speedLimitUnit)
    if let trip = activeTrip {
      template.update(
        travelEstimates(distanceMeters: update.remainingDistanceMeters, seconds: update.etaSeconds),
        for: trip
      )
    }
  }

  func endNavigation() {
    if navigationSession != nil {
      navigationSession?.finishTrip()
    }
    navigationSession = nil
    hideNavigationAlert()
    activeTrip = nil
    activePolyline = ""
    maneuverSignature = ""
    mapViewHost.clearRoute()
  }

  // MARK: Navigation alerts (rerouting banner, like the phone's blue banner)

  func showReroutingAlert() {
    guard let template = mapTemplate, reroutingAlert == nil else { return }
    let alert = CPNavigationAlert(
      titleVariants: ["Rerouting…"],
      subtitleVariants: ["Finding the best route"],
      imageSet: nil,
      duration: 0
    )
    reroutingAlert = alert
    template.present(navigationAlert: alert, animated: true)
  }

  func hideNavigationAlert() {
    guard reroutingAlert != nil, let template = mapTemplate else {
      reroutingAlert = nil
      return
    }
    reroutingAlert = nil
    template.dismissNavigationAlert(animated: true)
  }

  private func applyManeuvers(_ steps: [CarPlayManeuverStep]) {
    guard let session = navigationSession else { return }
    let maneuvers = steps.map { step in
      makeManeuver(
        instruction: step.instruction,
        shortInstruction: nil,
        maneuverType: step.maneuverType,
        distanceMeters: step.distanceMeters,
        durationSeconds: step.durationSeconds
      )
    }
    guard !maneuvers.isEmpty else { return }
    // Seed the signature from the live pair so the first steady-state update
    // takes the flicker-free estimates path instead of rebuilding.
    let first = steps[0]
    let second = steps.count > 1 ? steps[1] : nil
    maneuverSignature =
      "\(first.maneuverType)|\(first.instruction)|\(second?.maneuverType ?? "")|\(second?.instruction ?? "")|false"
    session.upcomingManeuvers = maneuvers
  }

  private func travelEstimates(distanceMeters: Double, seconds: Double) -> CPTravelEstimates {
    let time = seconds > 0 ? seconds : distanceMeters / (40_000 / 3600)
    return CPTravelEstimates(
      distanceRemaining: Measurement(value: max(distanceMeters, 0), unit: UnitLength.meters),
      timeRemaining: max(time, 0)
    )
  }

  private func makeManeuver(
    instruction: String,
    shortInstruction: String?,
    maneuverType typeName: String,
    distanceMeters: Double,
    durationSeconds: Double,
    laneImage: UIImage? = nil
  ) -> CPManeuver {
    let maneuver = CPManeuver()
    // Long-to-short variants so CarPlay picks the longest string that fits,
    // mirroring the phone banner's full instruction + compact fallback.
    if let short = shortInstruction, !short.isEmpty, short != instruction {
      maneuver.instructionVariants = [instruction, short]
    } else {
      maneuver.instructionVariants = [instruction]
    }
    // Maneuver metadata (17.4+) feeds instrument-cluster/HUD sharing and
    // helps head units pick the right symbol. Guarded for the 16.4 target.
    if #available(iOS 17.4, *) {
      maneuver.maneuverType = maneuverType(for: typeName)
      maneuver.junctionType = typeName.contains("roundabout") ? .roundabout : .intersection
    }
    if let lanes = laneImage {
      maneuver.symbolImage = lanes
      maneuver.userInfo = ["laneGuidance": true]
    } else {
      maneuver.symbolImage = maneuverSymbol(for: typeName)
    }
    maneuver.initialTravelEstimates = travelEstimates(
      distanceMeters: distanceMeters, seconds: durationSeconds)
    return maneuver
  }

  /// Maps Valhalla maneuver type strings (see src/models/route.ts) to the
  /// CarPlay maneuver taxonomy so head units render the right symbol/label.
  private func maneuverType(for typeName: String) -> CPManeuverType {
    switch typeName {
    case "start": return .startRoute
    case "destination": return .arriveAtDestination
    case "turn_left": return .leftTurn
    case "turn_right": return .rightTurn
    case "sharp_left": return .sharpLeftTurn
    case "sharp_right": return .sharpRightTurn
    case "slight_left": return .slightLeftTurn
    case "slight_right": return .slightRightTurn
    case "continue": return .straightAhead
    case "name_change": return .followRoad
    case "u_turn": return .uTurn
    case "merge_left", "enter_highway": return .keepLeft
    case "merge_right": return .keepRight
    case "enter_roundabout": return .enterRoundabout
    case "exit_roundabout": return .exitRoundabout
    case "exit_highway": return .offRamp
    case "ferry": return .enterFerry
    default: return .noTurn
    }
  }

  private func maneuverSymbol(for typeName: String) -> UIImage? {
    let name: String
    switch typeName {
    case "turn_left", "sharp_left", "slight_left", "merge_left": name = "arrow.turn.up.left"
    case "turn_right", "sharp_right", "slight_right", "merge_right": name = "arrow.turn.up.right"
    case "u_turn": name = "arrow.uturn.left"
    case "enter_roundabout", "exit_roundabout": name = "arrow.clockwise"
    case "enter_highway", "exit_highway": name = "arrow.up.right"
    case "destination": name = "flag.checkered"
    case "start": name = "location.fill"
    case "ferry": name = "ferry.fill"
    default: name = "arrow.up"
    }
    return UIImage(systemName: name)
  }

  private func totalDuration(_ payload: CarPlayStartNavigationPayload) -> TimeInterval {
    let fromManeuvers = payload.maneuvers.reduce(0) { $0 + $1.durationSeconds }
    if fromManeuvers > 0 { return fromManeuvers }
    // Fall back to a rough urban average of 40 km/h.
    return payload.maneuvers.reduce(0) { $0 + $1.distanceMeters } / (40_000 / 3600)
  }

  // MARK: Camera

  func updateCamera(lat: Double, lng: Double, heading: Double) {
    mapViewHost.updateCenter(lat: lat, lng: lng, heading: heading)
  }

  // MARK: Route traffic

  func applyRouteTraffic(_ ranges: [RouteTrafficRange]) {
    mapViewHost.showTraffic(ranges)
  }

  // MARK: Search

  func replaceSearchResults(_ items: [CarPlaySearchItem]) {
    searchItems = items
    finishPendingSearch()
  }

  private func makeListItem(from item: CarPlaySearchItem) -> CPListItem {
    let listItem = CPListItem(text: item.name, detailText: item.subtitle)
    listItem.userInfo = ["lat": item.lat, "lng": item.lng, "name": item.name]
    return listItem
  }

  private func listItems(for searchText: String) -> [CPListItem] {
    let query = searchText.lowercased()
    let matches =
      query.isEmpty
      ? searchItems
      : searchItems.filter {
        $0.name.lowercased().contains(query) || $0.subtitle.lowercased().contains(query)
      }
    return matches.prefix(12).map { makeListItem(from: $0) }
  }

  private func finishPendingSearch() {
    guard let completion = pendingSearchCompletion else { return }
    pendingSearchCompletion = nil
    completion(listItems(for: activeSearchText))
  }

  // MARK: CPSearchTemplateDelegate

  func searchTemplate(
    _ searchTemplate: CPSearchTemplate,
    updatedSearchText searchText: String,
    completionHandler: @escaping ([CPListItem]) -> Void
  ) {
    // Complete the previous request before replacing it. CarPlay invokes this
    // delegate for each keystroke, while the JS search pipeline is async.
    finishPendingSearch()
    activeSearchText = searchText
    pendingSearchCompletion = completionHandler
    PolarisCarPlay.emitSearchQuery(searchText)
  }

  func searchTemplate(_ searchTemplate: CPSearchTemplate, selectedResult item: CPListItem, completionHandler: @escaping () -> Void) {
    defer { completionHandler() }
    guard
      let userInfo = item.userInfo as? [String: Any],
      let lat = userInfo["lat"] as? Double,
      let lng = userInfo["lng"] as? Double
    else { return }
    PolarisCarPlay.emitSearchResultSelected(name: userInfo["name"] as? String, lat: lat, lng: lng)
    interfaceController?.popTemplate(animated: true, completion: nil)
  }

  // MARK: CPMapTemplateDelegate

  func mapTemplate(_ mapTemplate: CPMapTemplate, displayStyleFor maneuver: CPManeuver) -> CPManeuverDisplayStyle {
    // Lane-guidance strips render symbol-only, like the phone's lane row.
    if let info = maneuver.userInfo as? [String: Any], info["laneGuidance"] as? Bool == true {
      return .symbolOnly
    }
    return .leadingSymbol
  }

  func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
    endNavigation()
  }

  // MARK: CPSessionConfigurationDelegate

  func sessionConfiguration(
    _ sessionConfiguration: CPSessionConfiguration,
    limitedUserInterfacesChanged limitedUserInterfaces: CPLimitableUserInterface
  ) {
  }
}

/// Renders the phone-style lane guidance strip (one arrow per lane, recommended
/// lanes bright, the rest dimmed) as a CarPlay guidance-panel image. Stays
/// within the 120pt × 18pt full-width limit for second-maneuver symbols.
enum LaneStripImage {
  static func make(from lanes: CarPlayLaneInfo) -> UIImage? {
    let count = min(lanes.laneDirections.count, lanes.laneCount)
    guard count >= 2 else { return nil }
    let cellWidth: CGFloat = 22
    let height: CGFloat = 18
    let width = min(CGFloat(count) * cellWidth, 120)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
    return renderer.image { ctx in
      for i in 0..<count {
        let active = lanes.activeLanes.contains(i)
        let color: UIColor = active ? .white : UIColor(white: 1, alpha: 0.35)
        let cx = CGFloat(i) * cellWidth + cellWidth / 2
        drawArrow(at: CGPoint(x: cx, y: height / 2), angle: angle(for: lanes.laneDirections[i]), color: color, in: ctx.cgContext)
      }
    }
  }

  private static func angle(for direction: String) -> CGFloat {
    // Screen radians, 0 = up. Mirrors the phone's lane glyph rotations.
    switch direction {
    case "left": return -.pi / 2
    case "slight_left": return -.pi / 4
    case "slight_right": return .pi / 4
    case "right": return .pi / 2
    case "merge_left": return -.pi / 6
    case "merge_right": return .pi / 6
    case "u_turn": return .pi
    default: return 0
    }
  }

  private static func drawArrow(at center: CGPoint, angle: CGFloat, color: UIColor, in ctx: CGContext) {
    ctx.saveGState()
    ctx.translateBy(x: center.x, y: center.y)
    ctx.rotate(by: angle)
    // Up-arrow: shaft + head, roughly 7pt wide × 14pt tall.
    let shaft = CGRect(x: -1.75, y: -1, width: 3.5, height: 9)
    let head = CGMutablePath()
    head.move(to: CGPoint(x: 0, y: -7))
    head.addLine(to: CGPoint(x: 5, y: 0))
    head.addLine(to: CGPoint(x: 2, y: 0))
    head.addLine(to: CGPoint(x: 2, y: 1))
    head.addLine(to: CGPoint(x: -2, y: 1))
    head.addLine(to: CGPoint(x: -2, y: 0))
    head.addLine(to: CGPoint(x: -5, y: 0))
    head.closeSubpath()
    ctx.setFillColor(color.cgColor)
    ctx.fill(shaft)
    ctx.addPath(head)
    ctx.fillPath()
    ctx.restoreGState()
  }
}

extension PolarisCarPlay {
  fileprivate static func emitSearchQuery(_ query: String) {
    emit("searchQuery", ["query": query])
  }

  fileprivate static func emitSearchResultSelected(name: String?, lat: Double, lng: Double) {
    var body: [String: Any] = ["lat": lat, "lng": lng]
    body["name"] = name
    emit("searchResultSelected", body)
  }
}
