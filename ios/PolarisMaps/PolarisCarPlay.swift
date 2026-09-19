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

  /// Publishes a buffered scene connection. Always activates on the main
  /// thread: `init` and `startObserving` run on RN bridge queues, and
  /// UIKit/CarPlay calls made off-main raise and abort the process (SIGABRT on
  /// CarPlay connect).
  ///
  /// Activation deliberately does NOT wait for the RN-managed instance. A
  /// cold launch from the CarPlay home screen may create only the CarPlay
  /// template scene, never the phone window scene — so React Native (and this
  /// module) can attach much later. Gating on `instance` left the app icon
  /// unresponsive; the template is purely native, and `carPlayConnected` is
  /// replayed to JS once the module attaches (see `startObserving`/`init`).
  static func attachPendingSceneIfNeeded() {
    guard pendingInterfaceController != nil, pendingWindow != nil else { return }
    guard Thread.isMainThread else {
      DispatchQueue.main.async { Self.attachPendingSceneIfNeeded() }
      return
    }
    mapTemplateManager.activate(
      interfaceController: pendingInterfaceController!, window: pendingWindow!)
    emitContentStyle(dark: mapTemplateManager.contentStyleIsDark)
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
    return [
      "carPlayConnected", "carPlayDisconnected", "searchQuery", "searchResultSelected",
      "searchResultAddStop", "carPlayRouteStart", "carPlayContentStyleChanged",
      "carPlayToggleMute", "carPlayArrivalDismiss", "carPlayDashboardFavorite",
      "carPlayNavigationCancelled",
    ]
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

  @objc func showTripPreview(_ data: NSDictionary) {
    DispatchQueue.main.async { Self.mapTemplateManager.showTripPreview(with: data) }
  }

  @objc func hideTripPreview() {
    DispatchQueue.main.async { Self.mapTemplateManager.hideTripPreview() }
  }

  @objc func showArrival(_ data: NSDictionary) {
    DispatchQueue.main.async { Self.mapTemplateManager.showArrival(with: data) }
  }

  @objc func showIncidentAlert(_ data: NSDictionary) {
    DispatchQueue.main.async { Self.mapTemplateManager.showIncidentAlert(with: data) }
  }

  @objc func updateIncidents(_ incidents: NSArray) {
    let markers = incidents.compactMap { element -> CarPlayIncidentMarker? in
      guard let dict = element as? NSDictionary,
        let lat = (dict["lat"] as? NSNumber)?.doubleValue,
        let lng = (dict["lng"] as? NSNumber)?.doubleValue
      else { return nil }
      return CarPlayIncidentMarker(
        coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
        type: dict["type"] as? String ?? "other"
      )
    }
    DispatchQueue.main.async { Self.mapTemplateManager.updateIncidents(markers) }
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

  @objc func updateMapStyle(_ json: String) {
    DispatchQueue.main.async { Self.mapTemplateManager.applyMapStyle(json) }
  }

  @objc func updateRouteTraffic(_ ranges: NSArray) {
    let parsed = ranges.compactMap { element -> RouteTrafficRange? in
      guard let dict = element as? NSDictionary,
        let hex = dict["color"] as? String,
        let from = (dict["from"] as? NSNumber)?.intValue,
        let to = (dict["to"] as? NSNumber)?.intValue,
        let color = UIColor(hexString: hex)
      else { return nil }
      return RouteTrafficRange(color: color, hex: hex, from: from, to: to)
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
  let muted: Bool
  /// Overall route traffic color for the ETA pill: green/orange/red/default.
  let etaColor: String
  /// Highway exit number/label for exit maneuvers (e.g. "91B").
  let highwayExitLabel: String?

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
    muted = (data["muted"] as? NSNumber)?.boolValue ?? false
    etaColor = data["etaColor"] as? String ?? "default"
    let exit = data["highwayExitLabel"] as? String ?? ""
    highwayExitLabel = exit.isEmpty ? nil : exit
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
  /// Phone-banner text (verbal-first); preferred for display.
  let displayInstruction: String
  let maneuverType: String
  let distanceMeters: Double
  let durationSeconds: Double
  /// Mirrors the update-path signature so the first live update is flicker-free.
  let hasLaneGuidance: Bool
}

/// One traffic-colored run over the route shape. `from`/`to` are inclusive
/// indices into the precision-6 decoded polyline, matching the JS builder.
struct RouteTrafficRange {
  let color: UIColor
  let hex: String
  let from: Int
  let to: Int
}

/// A crowd-reported incident to draw on the CarPlay map.
struct CarPlayIncidentMarker {
  let coordinate: CLLocationCoordinate2D
  let type: String
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
  /// Phone route-preview summary ("26 min · 13.8 mi"); preferred over local formatting.
  let routeSummary: String?
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
    routeSummary = data["routeSummary"] as? String
    var steps: [CarPlayManeuverStep] = []
    if let list = data["maneuvers"] as? NSArray {
      for entry in list {
        guard let m = entry as? NSDictionary,
          let instruction = m["instruction"] as? String
        else { continue }
        let display = m["displayInstruction"] as? String ?? ""
        steps.append(
          CarPlayManeuverStep(
            instruction: instruction,
            displayInstruction: display.isEmpty ? instruction : display,
            maneuverType: m["maneuverType"] as? String ?? "",
            distanceMeters: (m["distanceMeters"] as? NSNumber)?.doubleValue ?? 0,
            durationSeconds: (m["durationSeconds"] as? NSNumber)?.doubleValue ?? 0,
            hasLaneGuidance: (m["hasLaneGuidance"] as? NSNumber)?.boolValue ?? false
          ))
      }
    }
    maneuvers = steps
  }
}

/// One route the driver can pick from the CarPlay trip preview.
struct CarPlayTripPreviewRoute {
  let encodedPolyline: String
  let summary: String
  let distanceMeters: Double
  let durationSeconds: Double
}

struct CarPlayTripPreviewPayload {
  let destinationName: String
  let destinationLat: Double
  let destinationLng: Double
  let routes: [CarPlayTripPreviewRoute]

  init?(from data: NSDictionary) {
    guard
      let name = data["destinationName"] as? String,
      let lat = (data["destinationLat"] as? NSNumber)?.doubleValue,
      let lng = (data["destinationLng"] as? NSNumber)?.doubleValue,
      let rawRoutes = data["routes"] as? NSArray
    else { return nil }
    destinationName = name
    destinationLat = lat
    destinationLng = lng
    var parsed: [CarPlayTripPreviewRoute] = []
    for entry in rawRoutes {
      guard
        let route = entry as? NSDictionary,
        let polyline = route["encodedPolyline"] as? String
      else { continue }
      parsed.append(
        CarPlayTripPreviewRoute(
          encodedPolyline: polyline,
          summary: route["summary"] as? String ?? "",
          distanceMeters: (route["distanceMeters"] as? NSNumber)?.doubleValue ?? 0,
          durationSeconds: (route["durationSeconds"] as? NSNumber)?.doubleValue ?? 0
        ))
    }
    routes = parsed
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
  private var previewTrip: CPTrip?
  private var previewRoutes: [CarPlayTripPreviewRoute] = []
  private var previewDestination: CLLocationCoordinate2D?
  private var activeAlert: CPNavigationAlert?
  private var muteButton: CPBarButton?
  private var overviewButton: CPBarButton?
  private var isMuted = false
  private var isOverview = false

  /// Phone NextTurnBanner base colour (rgba(26,47,62,0.72) flattened).
  private static let guidanceBackgroundColor = UIColor(
    red: 26 / 255, green: 47 / 255, blue: 62 / 255, alpha: 1)
  private var searchItems: [CarPlaySearchItem] = []
  private var activeSearchText = ""
  private var pendingSearchCompletion: (([CPListItem]) -> Void)?
  private var appliedStyleHash = 0

  private lazy var mapViewHost = CarPlayMapViewHost()

  func activate(interfaceController: CPInterfaceController, window: CPWindow) {
    guard self.interfaceController == nil else { return }
    self.interfaceController = interfaceController

    mapViewHost.activate(in: window)

    let template = CPMapTemplate()
    template.mapDelegate = self
    template.mapButtons = makeMapButtons()
    // Base tint for the guidance banner, matching the phone's NextTurnBanner.
    template.guidanceBackgroundColor = Self.guidanceBackgroundColor
    configureNavigationBar(template)
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
    appliedStyleHash = 0
    isMuted = false
    isOverview = false
    muteButton = nil
    overviewButton = nil
    recenterButton = nil
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

  private var recenterButton: CPMapButton?

  private func makeMapButtons() -> [CPMapButton] {
    let recenter = makeMapButton(systemName: "location.fill") { [weak self] in
      self?.recenter()
    }
    recenterButton = recenter
    return [
      recenter,
      makeMapButton(systemName: "magnifyingglass") { [weak self] in self?.presentSearch() },
    ]
  }

  /// Returns to vehicle-follow and leaves the panning interface, like the
  /// recenter control in Apple/Google Maps.
  private func recenter() {
    mapViewHost.recenter()
    updateRecenterButton()
    if mapTemplate?.isPanningInterfaceVisible == true {
      mapTemplate?.dismissPanningInterface(animated: true)
    }
  }

  private func updateRecenterButton() {
    recenterButton?.image = UIImage(systemName: mapViewHost.isFollowing ? "location.fill" : "location")
  }

  private func makeMapButton(systemName: String, handler: @escaping () -> Void) -> CPMapButton {
    let button = CPMapButton { _ in handler() }
    button.image = UIImage(systemName: systemName)
    return button
  }

  // MARK: Navigation bar buttons (mute + route overview)

  /// The vehicle's light/dark preference, so JS can resolve the phone map style
  /// to match the head unit instead of the phone's theme.
  var contentStyleIsDark: Bool {
    sessionConfiguration?.contentStyle.contains(.dark) ?? false
  }

  private func configureNavigationBar(_ template: CPMapTemplate) {
    let mute = CPBarButton(image: UIImage(systemName: "speaker.wave.2.fill") ?? UIImage()) {
      [weak self] _ in self?.toggleMute()
    }
    muteButton = mute
    let overview = CPBarButton(image: UIImage(systemName: "map.fill") ?? UIImage()) {
      [weak self] _ in self?.toggleOverview()
    }
    overviewButton = overview
    template.leadingNavigationBarButtons = [mute]
    template.trailingNavigationBarButtons = [overview]
  }

  private func toggleMute() {
    isMuted.toggle()
    updateMuteButton()
    PolarisCarPlay.emitToggleMute()
  }

  private func updateMuteButton() {
    muteButton?.image = UIImage(
      systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
  }

  /// Zooms out to the whole route; pressing again (or recentering) returns to
  /// the follow camera.
  private func toggleOverview() {
    if isOverview {
      isOverview = false
      mapViewHost.recenter()
      overviewButton?.image = UIImage(systemName: "map.fill")
    } else {
      isOverview = true
      mapViewHost.showRouteOverview()
      overviewButton?.image = UIImage(systemName: "location.fill")
    }
    updateRecenterButton()
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
    // as a flashing banner with no route. A trip preview that the driver
    // already started leaves a session with no maneuver card, so fill it in.
    if navigationSession != nil && payload.encodedPolyline == activePolyline {
      applyManeuvers(payload.maneuvers)
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
    // Phone route-preview summary ("26 min · 13.8 mi") so units and order
    // always match the phone; legacy km formatting is the fallback.
    let summary =
      payload.routeSummary ?? String(format: "%.1f km · %d min", totalDistance / 1000, Int(totalTime / 60))
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
    template.updateEstimates(tripEstimates, for: trip)

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

    // Keep the mute button in sync when the phone toggles voice guidance.
    if update.muted != isMuted {
      isMuted = update.muted
      updateMuteButton()
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
          for: trip,
          with: timeRemainingColor(update.etaColor)
        )
      }
      return
    }

    var upcoming: [CPManeuver] = []
    let nativeLanes = supportsNativeLaneGuidance(update.laneGuidance)
    if !update.displayInstruction.isEmpty {
      upcoming.append(
        makeManeuver(
          instruction: update.displayInstruction,
          shortInstruction: update.instruction,
          maneuverType: update.maneuverType,
          distanceMeters: update.distanceToTurnMeters,
          durationSeconds: update.durationToTurnSeconds,
          laneGuidance: nativeLanes ? update.laneGuidance : nil,
          highwayExitLabel: update.highwayExitLabel
        ))
    }
    if let next = update.nextInstruction, !next.isEmpty {
      // On iOS 17.4+ the current maneuver carries native lane guidance
      // (`linkedLaneGuidance`), so the second "Then" slot only needs the
      // rasterized lane strip as a fallback on older systems.
      let lanes = update.laneGuidance
      let fallbackLanes = !nativeLanes && lanes?.isUsable == true ? lanes : nil
      upcoming.append(
        makeManeuver(
          instruction: next,
          shortInstruction: update.nextStreetNames.first,
          maneuverType: update.nextManeuverType ?? "",
          distanceMeters: update.nextDistanceMeters,
          durationSeconds: 0,
          laneImage: fallbackLanes.map { LaneStripImage.make(from: $0) } ?? nil
        ))
    }
    guard !upcoming.isEmpty else { return }
    maneuverSignature = update.signature
    session.upcomingManeuvers = upcoming
    if #available(iOS 17.4, *) {
      session.currentLaneGuidance =
        nativeLanes ? update.laneGuidance.flatMap { makeLaneGuidance($0) } : nil
    }
    mapViewHost.showSpeedLimit(value: update.speedLimitValue, unit: update.speedLimitUnit)
    if let trip = activeTrip {
      template.update(
        travelEstimates(distanceMeters: update.remainingDistanceMeters, seconds: update.etaSeconds),
        for: trip,
        with: timeRemainingColor(update.etaColor)
      )
    }
  }

  /// Maps the JS traffic color for the ETA pill to the CarPlay enum.
  private func timeRemainingColor(_ raw: String) -> CPTimeRemainingColor {
    switch raw {
    case "green": return .green
    case "orange": return .orange
    case "red": return .red
    default: return .default
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
    previewTrip = nil
    previewRoutes = []
    previewDestination = nil
    mapViewHost.clearRoute()
  }

  // MARK: Trip preview (Apple/Google-style route options before starting)

  /// Shows the CarPlay trip preview with one route choice per computed route,
  /// drawing the primary route and the rest as grey alternates. The driver
  /// picks a route and taps Go; `mapTemplate(_:startedTrip:using:)` then emits
  /// `carPlayRouteStart` so JS starts the matching phone-side navigation.
  func showTripPreview(with data: NSDictionary) {
    guard let template = mapTemplate, let payload = CarPlayTripPreviewPayload(from: data),
      !payload.routes.isEmpty
    else { return }

    endNavigation()

    let origin = MKMapItem(placemark: MKPlacemark(coordinate: mapViewHost.currentCoordinate))
    origin.name = "Current location"
    let destinationCoordinate = CLLocationCoordinate2D(
      latitude: payload.destinationLat, longitude: payload.destinationLng)
    let destination = MKMapItem(placemark: MKPlacemark(coordinate: destinationCoordinate))
    destination.name = payload.destinationName

    var choices: [CPRouteChoice] = []
    for (index, route) in payload.routes.enumerated() {
      let summary =
        route.summary.isEmpty
        ? String(
          format: "%.1f km · %d min", route.distanceMeters / 1000,
          Int(route.durationSeconds / 60))
        : route.summary
      let choice = CPRouteChoice(
        summaryVariants: [summary],
        additionalInformationVariants: [],
        selectionSummaryVariants: [payload.destinationName]
      )
      choice.userInfo = index
      choices.append(choice)
    }

    let trip = CPTrip(origin: origin, destination: destination, routeChoices: choices)
    previewTrip = trip
    previewRoutes = payload.routes
    previewDestination = destinationCoordinate

    mapViewHost.showRoute(
      encodedPolyline: payload.routes[0].encodedPolyline,
      destination: destinationCoordinate,
      alternates: payload.routes.dropFirst().map { $0.encodedPolyline }
    )

    let text = CPTripPreviewTextConfiguration(
      startButtonTitle: "Go",
      additionalRoutesButtonTitle: "Routes",
      overviewButtonTitle: "Overview"
    )
    template.showTripPreviews([trip], textConfiguration: text)
  }

  /// Dismisses the trip preview. The map route is only cleared when no
  /// navigation session is active, so starting a trip doesn't wipe the line.
  func hideTripPreview() {
    previewTrip = nil
    previewRoutes = []
    previewDestination = nil
    mapTemplate?.hideTripPreviews()
    if navigationSession == nil {
      mapViewHost.clearRoute()
    }
  }

  // MARK: Navigation alerts (rerouting, incidents, arrival)

  func showReroutingAlert() {
    guard mapTemplate != nil, activeAlert == nil else { return }
    // The SDK requires at least a primary action on navigation alerts.
    let dismiss = CPAlertAction(title: "Dismiss", style: .cancel) { [weak self] _ in
      self?.hideNavigationAlert()
    }
    presentAlert(
      CPNavigationAlert(
        titleVariants: ["Rerouting…"],
        subtitleVariants: ["Finding the best route"],
        image: nil,
        primaryAction: dismiss,
        secondaryAction: nil,
        duration: 0
      ))
  }

  func hideNavigationAlert() {
    guard activeAlert != nil, let template = mapTemplate else {
      activeAlert = nil
      return
    }
    activeAlert = nil
    template.dismissNavigationAlert(animated: true, completion: { _ in })
  }

  /// Transient crowd-reported incident warning, mirroring the phone's
  /// `IncidentAheadBanner` (auto-dismisses after the minimum duration).
  func showIncidentAlert(with data: NSDictionary) {
    guard mapTemplate != nil, activeAlert == nil else { return }
    let label = data["label"] as? String ?? "Incident"
    let distanceMeters = (data["distanceMeters"] as? NSNumber)?.doubleValue ?? 0
    let dismiss = CPAlertAction(title: "Dismiss", style: .cancel) { [weak self] _ in
      self?.hideNavigationAlert()
    }
    presentAlert(
      CPNavigationAlert(
        titleVariants: ["\(label) ahead"],
        subtitleVariants: [formattedDistance(distanceMeters)],
        image: nil,
        primaryAction: dismiss,
        secondaryAction: nil,
        duration: CPNavigationAlertMinimumDuration
      ))
  }

  /// Arrival card shown when the destination is reached. "Done" ends the trip
  /// on both surfaces (the phone mirror stops via `carPlayArrivalDismiss`).
  func showArrival(with data: NSDictionary) {
    let name = data["destinationName"] as? String ?? "your destination"
    let done = CPAlertAction(title: "Done", style: .default) { [weak self] _ in
      self?.endNavigation()
      PolarisCarPlay.emitArrivalDismiss()
    }
    // Arrival replaces any transient alert still on screen.
    replaceAlert(
      CPNavigationAlert(
        titleVariants: ["You have arrived"],
        subtitleVariants: [name],
        image: nil,
        primaryAction: done,
        secondaryAction: nil,
        duration: 0
      ))
  }

  private func presentAlert(_ alert: CPNavigationAlert) {
    guard let template = mapTemplate else { return }
    activeAlert = alert
    template.present(navigationAlert: alert, animated: true)
  }

  private func replaceAlert(_ alert: CPNavigationAlert) {
    guard let template = mapTemplate else { return }
    if activeAlert != nil {
      activeAlert = nil
      template.dismissNavigationAlert(animated: false, completion: { _ in })
    }
    activeAlert = alert
    template.present(navigationAlert: alert, animated: true)
  }

  /// Locale-aware distance for alert subtitles (mirrors `MKDistanceFormatter`).
  private func formattedDistance(_ meters: Double) -> String {
    let formatter = MKDistanceFormatter()
    formatter.unitStyle = .abbreviated
    return formatter.string(fromDistance: meters)
  }

  private func applyManeuvers(_ steps: [CarPlayManeuverStep]) {
    guard let session = navigationSession else { return }
    let maneuvers = steps.map { step in
      makeManeuver(
        instruction: step.displayInstruction,
        shortInstruction: step.displayInstruction != step.instruction ? step.instruction : nil,
        maneuverType: step.maneuverType,
        distanceMeters: step.distanceMeters,
        durationSeconds: step.durationSeconds
      )
    }
    guard !maneuvers.isEmpty else { return }
    // Seed the signature from the live pair so the first steady-state update
    // takes the flicker-free estimates path instead of rebuilding. Shape
    // matches CarPlayNavigationUpdate.signature: display text for the
    // current maneuver, raw instruction for the next, lane presence flag.
    let first = steps[0]
    let second = steps.count > 1 ? steps[1] : nil
    maneuverSignature =
      "\(first.maneuverType)|\(first.displayInstruction)|\(second?.maneuverType ?? "")|\(second?.instruction ?? "")|\(first.hasLaneGuidance)"
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
    laneImage: UIImage? = nil,
    laneGuidance: CarPlayLaneInfo? = nil,
    highwayExitLabel: String? = nil
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
      if let exit = highwayExitLabel, !exit.isEmpty {
        maneuver.highwayExitLabel = exit
      }
      if let lanes = laneGuidance, let guide = makeLaneGuidance(lanes) {
        maneuver.linkedLaneGuidance = guide
      }
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

  /// True when the OS can render lanes natively (`CPLaneGuidance`, 17.4+).
  /// When it can, we skip the rasterized lane-strip fallback to avoid
  /// showing the lanes twice.
  private func supportsNativeLaneGuidance(_ lanes: CarPlayLaneInfo?) -> Bool {
    guard #available(iOS 17.4, *), let lanes = lanes, lanes.isUsable else { return false }
    return makeLaneGuidance(lanes) != nil
  }

  /// Builds CarPlay's native lane guidance from the phone's lane model.
  @available(iOS 17.4, *)
  private func makeLaneGuidance(_ lanes: CarPlayLaneInfo) -> CPLaneGuidance? {
    guard lanes.laneCount >= 2, lanes.laneDirections.count >= 2 else { return nil }
    var result: [CPLane] = []
    for (index, direction) in lanes.laneDirections.enumerated() {
      let angle = Measurement(value: laneAngleDegrees(for: direction), unit: UnitAngle.degrees)
      let preferred = lanes.activeLanes.contains(index)
      if #available(iOS 18.0, *) {
        // iOS 18+ splits the highlighted angle out of `angles`; preferred
        // lanes carry the angle, the rest are plain `notGood` lanes.
        if preferred {
          result.append(CPLane(angles: [], highlightedAngle: angle, isPreferred: true))
        } else {
          result.append(CPLane(angles: [angle]))
        }
      } else {
        let lane = CPLane()
        lane.status = preferred ? .preferred : .notGood
        lane.primaryAngle = angle
        result.append(lane)
      }
    }
    guard !result.isEmpty else { return nil }
    let guidance = CPLaneGuidance()
    guidance.lanes = result
    guidance.instructionVariants = ["Use the highlighted lane"]
    return guidance
  }

  /// Screen degrees (0 = straight, negative = left) mirroring the phone's
  /// lane glyph rotations in `LaneStripImage`.
  private func laneAngleDegrees(for direction: String) -> Double {
    switch direction {
    case "left": return -90
    case "slight_left": return -45
    case "slight_right": return 45
    case "right": return 90
    case "merge_left": return -30
    case "merge_right": return 30
    case "u_turn": return 180
    default: return 0
    }
  }

  /// Maps Valhalla maneuver type strings (see src/models/route.ts) to the
  /// CarPlay maneuver taxonomy so head units render the right symbol/label.
  @available(iOS 17.4, *)
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
    case "ferry": return .enter_Ferry
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

  // MARK: Map style (phone parity: dark/light + satellite preference)

  /// Applies the phone's resolved map style JSON. Dedupes by content hash so
  /// repeated pushes are free; the host reloads the style in place and keeps
  /// route/traffic annotations.
  func applyMapStyle(_ json: String) {
    guard !json.isEmpty else { return }
    let hash = json.hashValue
    guard hash != appliedStyleHash else { return }
    appliedStyleHash = hash
    mapViewHost.applyStyle(json: json)
  }

  // MARK: Route traffic

  func applyRouteTraffic(_ ranges: [RouteTrafficRange]) {
    mapViewHost.showTraffic(ranges)
  }

  // MARK: Incident markers

  func updateIncidents(_ markers: [CarPlayIncidentMarker]) {
    mapViewHost.showIncidents(markers)
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
    // Show a detail sheet mirroring the phone's place card: navigate now or
    // add as a stop on the active drive (JS falls back to fresh navigation
    // when idle).
    completionHandler()
    guard
      let userInfo = item.userInfo as? [String: Any],
      let lat = userInfo["lat"] as? Double,
      let lng = userInfo["lng"] as? Double
    else { return }
    let name = userInfo["name"] as? String
    let startItem = CPListItem(
      text: "Start Navigation",
      detailText: name,
      image: UIImage(systemName: "car.fill")
    )
    startItem.handler = { [weak self] _, done in
      PolarisCarPlay.emitSearchResultSelected(name: name, lat: lat, lng: lng)
      self?.interfaceController?.popToRootTemplate(animated: true, completion: nil)
      done()
    }
    let addStopItem = CPListItem(
      text: "Add Stop",
      detailText: "Add to your current drive",
      image: UIImage(systemName: "plus.circle.fill")
    )
    addStopItem.handler = { [weak self] _, done in
      PolarisCarPlay.emitSearchResultAddStop(name: name, lat: lat, lng: lng)
      self?.interfaceController?.popToRootTemplate(animated: true, completion: nil)
      done()
    }
    let section = CPListSection(items: [startItem, addStopItem])
    let detail = CPListTemplate(title: name ?? "Destination", sections: [section])
    interfaceController?.pushTemplate(detail, animated: true, completion: nil)
  }

  // MARK: CPMapTemplateDelegate

  func mapTemplate(_ mapTemplate: CPMapTemplate, displayStyleFor maneuver: CPManeuver) -> CPManeuverDisplayStyle {
    // Lane-guidance strips render symbol-only, like the phone's lane row.
    if let info = maneuver.userInfo as? [String: Any], info["laneGuidance"] as? Bool == true {
      return .symbolOnly
    }
    return .leadingSymbol
  }

  func mapTemplate(
    _ mapTemplate: CPMapTemplate, selectedPreviewFor trip: CPTrip, using routeChoice: CPRouteChoice
  ) {
    guard let index = routeChoice.userInfo as? Int, previewRoutes.indices.contains(index) else {
      return
    }
    let route = previewRoutes[index]
    let alternates = previewRoutes.enumerated()
      .filter { $0.offset != index }
      .map { $0.element.encodedPolyline }
    mapViewHost.showRoute(
      encodedPolyline: route.encodedPolyline,
      destination: previewDestination,
      alternates: alternates
    )
  }

  func mapTemplate(
    _ mapTemplate: CPMapTemplate, startedTrip trip: CPTrip, using routeChoice: CPRouteChoice
  ) {
    let index = (routeChoice.userInfo as? Int) ?? 0
    guard previewRoutes.indices.contains(index) else { return }
    let route = previewRoutes[index]

    // Start the session here so CarPlay leaves the preview UI immediately. The
    // JS `startNavigation` that follows fills in the maneuver card.
    navigationSession = mapTemplate.startNavigationSession(for: trip)
    activeTrip = trip
    activePolyline = route.encodedPolyline
    mapViewHost.showRoute(encodedPolyline: route.encodedPolyline, destination: previewDestination)
    mapTemplate.updateEstimates(
      CPTravelEstimates(
        distanceRemaining: Measurement(value: route.distanceMeters, unit: UnitLength.meters),
        timeRemaining: route.durationSeconds
      ),
      for: trip
    )

    previewTrip = nil
    previewRoutes = []
    previewDestination = nil
    PolarisCarPlay.emitRouteStart(index)
  }

  // MARK: Map interaction (look around, zoom, rotate)

  /// Any look-around gesture stops the follow camera and shows the panning UI;
  /// `recenter()` clears both.
  private func beginMapInteraction(_ mapTemplate: CPMapTemplate) {
    mapViewHost.beginUserInteraction()
    updateRecenterButton()
    if !mapTemplate.isPanningInterfaceVisible {
      mapTemplate.showPanningInterface(animated: true)
    }
  }

  func mapTemplateDidShowPanningInterface(_ mapTemplate: CPMapTemplate) {
    mapViewHost.beginUserInteraction()
    updateRecenterButton()
  }

  func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {
    // Snap back to the vehicle once the driver leaves the panning interface.
    mapViewHost.recenter()
    updateRecenterButton()
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
    beginMapInteraction(mapTemplate)
    mapViewHost.pan(direction: direction)
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, panBeganWith direction: CPMapTemplate.PanDirection) {
    beginMapInteraction(mapTemplate)
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, panEndedWith direction: CPMapTemplate.PanDirection) {
    beginMapInteraction(mapTemplate)
    mapViewHost.pan(direction: direction)
  }

  func mapTemplateDidBeginPanGesture(_ mapTemplate: CPMapTemplate) {
    beginMapInteraction(mapTemplate)
  }

  func mapTemplate(
    _ mapTemplate: CPMapTemplate, didUpdatePanGestureWithTranslation translation: CGPoint,
    velocity: CGPoint
  ) {
    mapViewHost.pan(byScreenTranslation: translation)
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, didEndPanGestureWithVelocity velocity: CGPoint) {
  }

  @available(iOS 26.0, *)
  func mapTemplateDidBeginZoomGesture(_ mapTemplate: CPMapTemplate) {
    beginMapInteraction(mapTemplate)
    mapViewHost.resetGestureTracking()
  }

  @available(iOS 26.0, *)
  func mapTemplate(
    _ mapTemplate: CPMapTemplate, didUpdateZoomGestureWithCenter center: CGPoint, scale: CGFloat,
    velocity: CGFloat
  ) {
    mapViewHost.applyZoomGesture(scale: scale)
  }

  @available(iOS 26.0, *)
  func mapTemplate(_ mapTemplate: CPMapTemplate, didEndZoomGestureWithVelocity velocity: CGFloat) {
    mapViewHost.resetGestureTracking()
  }

  @available(iOS 26.0, *)
  func mapTemplateDidBeginRotationGesture(_ mapTemplate: CPMapTemplate) {
    beginMapInteraction(mapTemplate)
    mapViewHost.resetGestureTracking()
  }

  @available(iOS 26.0, *)
  func mapTemplate(
    _ mapTemplate: CPMapTemplate, didRotateWithCenter center: CGPoint, rotation: CGFloat,
    velocity: CGFloat
  ) {
    mapViewHost.applyRotationGesture(rotation: rotation)
  }

  @available(iOS 26.0, *)
  func mapTemplate(_ mapTemplate: CPMapTemplate, rotationDidEndWithVelocity velocity: CGFloat) {
    mapViewHost.resetGestureTracking()
  }

  @available(iOS 26.0, *)
  func mapTemplateDidBeginPitchGesture(_ mapTemplate: CPMapTemplate) {
    beginMapInteraction(mapTemplate)
  }

  @available(iOS 26.0, *)
  func mapTemplate(_ mapTemplate: CPMapTemplate, pitchWithCenter center: CGPoint) {
    mapViewHost.beginUserInteraction()
  }

  @available(iOS 26.0, *)
  func mapTemplate(_ mapTemplate: CPMapTemplate, pitchEndedWithCenter center: CGPoint) {
  }

  func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
    // The driver ended the trip from CarPlay; mirror the phone's state so the
    // phone stops navigating instead of silently continuing.
    endNavigation()
    PolarisCarPlay.emitNavigationCancelled()
  }

  // MARK: CPSessionConfigurationDelegate

  func sessionConfiguration(
    _ sessionConfiguration: CPSessionConfiguration,
    limitedUserInterfacesChanged limitedUserInterfaces: CPLimitableUserInterface
  ) {
  }

  /// The head unit switched light/dark; JS resolves the matching phone map
  /// style so CarPlay tracks the car, not the phone.
  func sessionConfiguration(
    _ sessionConfiguration: CPSessionConfiguration, contentStyleChanged contentStyle: CPContentStyle
  ) {
    PolarisCarPlay.emitContentStyle(dark: contentStyle.contains(.dark))
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

  fileprivate static func emitSearchResultAddStop(name: String?, lat: Double, lng: Double) {
    var body: [String: Any] = ["lat": lat, "lng": lng]
    body["name"] = name
    emit("searchResultAddStop", body)
  }

  fileprivate static func emitRouteStart(_ index: Int) {
    emit("carPlayRouteStart", ["index": index])
  }

  fileprivate static func emitContentStyle(dark: Bool) {
    emit("carPlayContentStyleChanged", ["dark": dark])
  }

  fileprivate static func emitToggleMute() {
    emit("carPlayToggleMute", [:])
  }

  fileprivate static func emitArrivalDismiss() {
    emit("carPlayArrivalDismiss", [:])
  }

  /// Called from the dashboard scene delegate (separate file), so it must be
  /// internal rather than fileprivate.
  static func emitDashboardFavorite(_ kind: String) {
    emit("carPlayDashboardFavorite", ["kind": kind])
  }

  fileprivate static func emitNavigationCancelled() {
    emit("carPlayNavigationCancelled", [:])
  }
}
