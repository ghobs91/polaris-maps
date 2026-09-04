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

struct CarPlayNavigationUpdate {
  let isNavigating: Bool
  let instruction: String
  let distanceToTurnMeters: Double
  let etaSeconds: Double
  let remainingDistanceMeters: Double
  let nextInstruction: String?

  init(from data: NSDictionary) {
    isNavigating = (data["isNavigating"] as? NSNumber)?.boolValue ?? false
    instruction = data["instruction"] as? String ?? ""
    distanceToTurnMeters = (data["distanceToTurnMeters"] as? NSNumber)?.doubleValue ?? 0
    etaSeconds = (data["etaSeconds"] as? NSNumber)?.doubleValue ?? 0
    remainingDistanceMeters = (data["remainingDistanceMeters"] as? NSNumber)?.doubleValue ?? 0
    nextInstruction = data["nextInstruction"] as? String
  }
}

struct CarPlayStartNavigationPayload {
  let destinationName: String
  let destinationLat: Double
  let destinationLng: Double
  let encodedPolyline: String
  let maneuvers: [(instruction: String, distanceMeters: Double)]

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
    var steps: [(String, Double)] = []
    if let list = data["maneuvers"] as? NSArray {
      for entry in list {
        guard let m = entry as? NSDictionary,
          let instruction = m["instruction"] as? String
        else { continue }
        steps.append((instruction, (m["distanceMeters"] as? NSNumber)?.doubleValue ?? 0))
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
    let summary = String(format: "%.1f km · %d min", totalDistance / 1000, Int(totalDuration(payload)))
    let routeChoice = CPRouteChoice(
      summaryVariants: [summary],
      additionalInformationVariants: [],
      selectionSummaryVariants: [payload.destinationName]
    )
    routeChoice.userInfo = payload.encodedPolyline

    let trip = CPTrip(origin: origin, destination: destination, routeChoices: [routeChoice])

    mapViewHost.showRoute(encodedPolyline: payload.encodedPolyline)
    navigationSession = template.startNavigationSession(for: trip)
    applyManeuvers(payload.maneuvers.dropFirst().map { $0 })
  }

  func applyNavigationUpdate(_ update: CarPlayNavigationUpdate) {
    guard update.isNavigating, let session = navigationSession else { return }

    var upcoming: [CPManeuver] = []
    if !update.instruction.isEmpty {
      upcoming.append(makeManeuver(instruction: update.instruction, distanceMeters: update.distanceToTurnMeters))
    }
    if let next = update.nextInstruction {
      upcoming.append(makeManeuver(instruction: next, distanceMeters: 0))
    }
    session.upcomingManeuvers = upcoming
  }

  func endNavigation() {
    navigationSession?.finishTrip()
    navigationSession = nil
    mapViewHost.clearRoute()
  }

  private func applyManeuvers(_ steps: [(instruction: String, distanceMeters: Double)]) {
    guard let session = navigationSession else { return }
    session.upcomingManeuvers = steps.map { step in
      makeManeuver(instruction: step.instruction, distanceMeters: step.distanceMeters)
    }
  }

  private func makeManeuver(instruction: String, distanceMeters: Double) -> CPManeuver {
    let maneuver = CPManeuver()
    maneuver.instructionVariants = [instruction]
    if distanceMeters > 0 {
      maneuver.initialTravelEstimates = CPTravelEstimates(
        distanceRemaining: Measurement(value: distanceMeters, unit: UnitLength.meters),
        timeRemaining: distanceMeters / (40_000 / 3600)
      )
    }
    return maneuver
  }

  private func totalDuration(_ payload: CarPlayStartNavigationPayload) -> TimeInterval {
    // Rough urban average of 40 km/h keeps the preview estimate stable.
    return payload.maneuvers.reduce(0) { $0 + $1.distanceMeters } / (40_000 / 3600)
  }

  // MARK: Camera

  func updateCamera(lat: Double, lng: Double, heading: Double) {
    mapViewHost.updateCenter(lat: lat, lng: lng, heading: heading)
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
