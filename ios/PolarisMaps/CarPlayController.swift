import CarPlay
import MapKit
import UIKit

/// Manages the CarPlay UI using the CPApplicationDelegate (non-scene) API.
/// This avoids UIApplicationSceneManifest which breaks React Native's traditional
/// UIApplicationDelegate window lifecycle.
@objc(CarPlayController)
class CarPlayController: NSObject {

  @objc static let shared = CarPlayController()

  var interfaceController: CPInterfaceController?
  var carWindow: CPWindow?
  var mapTemplate: CPMapTemplate?
  var navigationSession: CPNavigationSession?

  private var mapView: MKMapView?
  private var routeOverlay: MKPolyline?
  private var searchCompletionHandler: (([CPListItem]) -> Void)?
  private var isNavigating = false

  // MARK: - Connect / Disconnect (called from AppDelegate)

  @objc func connect(interfaceController: CPInterfaceController, window: CPWindow) {
    self.interfaceController = interfaceController
    self.carWindow = window

    let mapVC = UIViewController()
    let map = MKMapView()
    map.translatesAutoresizingMaskIntoConstraints = false
    map.showsUserLocation = true
    map.userTrackingMode = .followWithHeading
    map.delegate = self
    map.pointOfInterestFilter = .excludingAll
    mapVC.view.addSubview(map)
    NSLayoutConstraint.activate([
      map.topAnchor.constraint(equalTo: mapVC.view.topAnchor),
      map.bottomAnchor.constraint(equalTo: mapVC.view.bottomAnchor),
      map.leadingAnchor.constraint(equalTo: mapVC.view.leadingAnchor),
      map.trailingAnchor.constraint(equalTo: mapVC.view.trailingAnchor),
    ])
    self.mapView = map
    window.rootViewController = mapVC

    let template = CPMapTemplate()
    template.mapDelegate = self

    let searchButton = CPBarButton(title: "Search") { [weak self] _ in
      self?.showSearch()
    }
    template.leadingNavigationBarButtons = [searchButton]

    let panButton = CPMapButton { [weak self] _ in
      self?.mapTemplate?.showPanningInterface(animated: true)
    }
    panButton.image = UIImage(systemName: "arrow.up.and.down.and.arrow.left.and.right")

    let zoomInButton = CPMapButton { [weak self] _ in
      guard let map = self?.mapView else { return }
      let camera = map.camera.copy() as! MKMapCamera
      camera.centerCoordinateDistance = max(camera.centerCoordinateDistance / 2, 200)
      map.setCamera(camera, animated: true)
    }
    zoomInButton.image = UIImage(systemName: "plus.magnifyingglass")

    let zoomOutButton = CPMapButton { [weak self] _ in
      guard let map = self?.mapView else { return }
      let camera = map.camera.copy() as! MKMapCamera
      camera.centerCoordinateDistance = min(camera.centerCoordinateDistance * 2, 500_000)
      map.setCamera(camera, animated: true)
    }
    zoomOutButton.image = UIImage(systemName: "minus.magnifyingglass")

    let recenterButton = CPMapButton { [weak self] _ in
      self?.mapView?.userTrackingMode = .followWithHeading
    }
    recenterButton.image = UIImage(systemName: "location.fill")

    template.mapButtons = [panButton, zoomInButton, zoomOutButton, recenterButton]

    self.mapTemplate = template
    interfaceController.setRootTemplate(template, animated: true, completion: nil)

    PolarisCarPlay.emitCarPlayEvent("carPlayConnected", body: [:])
  }

  @objc func disconnect() {
    PolarisCarPlay.emitCarPlayEvent("carPlayDisconnected", body: [:])
    self.interfaceController = nil
    self.carWindow = nil
    self.mapView = nil
    self.mapTemplate = nil
    self.navigationSession = nil
    self.routeOverlay = nil
    self.searchCompletionHandler = nil
    self.isNavigating = false
  }

  // MARK: - Search

  func showSearch() {
    let searchTemplate = CPSearchTemplate()
    searchTemplate.delegate = self
    interfaceController?.pushTemplate(searchTemplate, animated: true, completion: nil)
  }

  /// Called from JS when search results are ready.
  func pushSearchResults(_ results: [[String: Any]]) {
    let items = results.prefix(12).map { data -> CPListItem in
      let item = CPListItem(
        text: data["name"] as? String ?? "",
        detailText: data["subtitle"] as? String
      )
      item.userInfo = data
      return item
    }
    searchCompletionHandler?(items)
    searchCompletionHandler = nil
  }

  // MARK: - Navigation

  func startNavigationSession(
    destinationName: String,
    destinationLat: Double,
    destinationLng: Double,
    encodedPolyline: String,
    maneuvers: [[String: Any]]
  ) {
    guard let mapTemplate = mapTemplate else { return }

    let coords = Self.decodePolyline(encodedPolyline, precision: 6)
    if let existing = routeOverlay {
      mapView?.removeOverlay(existing)
    }
    let polyline = MKPolyline(coordinates: coords, count: coords.count)
    routeOverlay = polyline
    mapView?.addOverlay(polyline)

    mapView?.setVisibleMapRect(
      polyline.boundingMapRect,
      edgePadding: UIEdgeInsets(top: 60, left: 40, bottom: 60, right: 40),
      animated: true
    )

    let destCoord = CLLocationCoordinate2D(latitude: destinationLat, longitude: destinationLng)
    let destPlacemark = MKPlacemark(coordinate: destCoord)
    let destItem = MKMapItem(placemark: destPlacemark)
    destItem.name = destinationName

    let routeChoice = CPRouteChoice(
      summaryVariants: [destinationName],
      additionalInformationVariants: [],
      selectionSummaryVariants: [destinationName]
    )
    let trip = CPTrip(
      origin: MKMapItem.forCurrentLocation(),
      destination: destItem,
      routeChoices: [routeChoice]
    )

    let session = mapTemplate.startNavigationSession(for: trip)
    self.navigationSession = session
    self.isNavigating = true

    updateManeuvers(maneuvers)

    mapView?.userTrackingMode = .followWithHeading
  }

  func updateManeuvers(_ maneuverData: [[String: Any]]) {
    guard let session = navigationSession else { return }

    let cpManeuvers: [CPManeuver] = maneuverData.prefix(3).compactMap { data in
      let maneuver = CPManeuver()
      maneuver.instructionVariants = [data["instruction"] as? String ?? ""]

      if let symbolName = data["symbolName"] as? String,
         let symbol = UIImage(systemName: symbolName)
      {
        maneuver.symbolImage = symbol
      }

      if let distanceMeters = data["distanceMeters"] as? Double {
        maneuver.initialTravelEstimates = CPTravelEstimates(
          distanceRemaining: Measurement(value: distanceMeters, unit: UnitLength.meters),
          timeRemaining: data["durationSeconds"] as? Double ?? 0
        )
      }
      return maneuver
    }

    session.upcomingManeuvers = cpManeuvers
  }

  func updateTravelEstimates(distanceMeters: Double, timeSeconds: Double) {
    guard let session = navigationSession,
          let maneuver = session.upcomingManeuvers.first
    else { return }

    let estimates = CPTravelEstimates(
      distanceRemaining: Measurement(value: distanceMeters, unit: UnitLength.meters),
      timeRemaining: timeSeconds
    )
    session.updateEstimates(estimates, for: maneuver)
  }

  func endNavigationSession() {
    navigationSession?.finishTrip()
    navigationSession = nil
    isNavigating = false

    if let overlay = routeOverlay {
      mapView?.removeOverlay(overlay)
      routeOverlay = nil
    }

    mapView?.userTrackingMode = .followWithHeading
  }

  func updateMapCenter(latitude: Double, longitude: Double, heading: Double) {
    guard let map = mapView, !isNavigating else { return }
    let coord = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    let camera = MKMapCamera(
      lookingAtCenter: coord,
      fromDistance: 1000,
      pitch: 0,
      heading: heading
    )
    map.setCamera(camera, animated: true)
  }

  // MARK: - Polyline Decoding

  static func decodePolyline(_ encoded: String, precision: Int = 6) -> [CLLocationCoordinate2D] {
    let factor = pow(10.0, Double(precision))
    var coordinates: [CLLocationCoordinate2D] = []
    var lat = 0
    var lng = 0

    let bytes = Array(encoded.utf8)
    var index = 0

    while index < bytes.count {
      var shift = 0
      var result = 0
      var byte: Int
      repeat {
        guard index < bytes.count else { break }
        byte = Int(bytes[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
      } while byte >= 0x20

      lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1)

      shift = 0
      result = 0
      repeat {
        guard index < bytes.count else { break }
        byte = Int(bytes[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
      } while byte >= 0x20

      lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1)

      coordinates.append(CLLocationCoordinate2D(
        latitude: Double(lat) / factor,
        longitude: Double(lng) / factor
      ))
    }

    return coordinates
  }

  // MARK: - Maneuver Symbol Mapping

  static func symbolName(for maneuverType: String) -> String {
    switch maneuverType {
    case "start": return "location.fill"
    case "destination": return "mappin.circle.fill"
    case "turn_left": return "arrow.turn.up.left"
    case "turn_right": return "arrow.turn.up.right"
    case "sharp_left": return "arrow.turn.up.left"
    case "sharp_right": return "arrow.turn.up.right"
    case "slight_left": return "arrow.up.left"
    case "slight_right": return "arrow.up.right"
    case "continue", "name_change": return "arrow.up"
    case "u_turn": return "arrow.uturn.left"
    case "merge_left", "merge_right": return "arrow.merge"
    case "enter_roundabout": return "arrow.triangle.swap"
    case "exit_roundabout": return "arrow.up.right"
    case "enter_highway": return "arrow.up.right"
    case "exit_highway": return "arrow.turn.up.right"
    case "ferry": return "ferry.fill"
    default: return "arrow.up"
    }
  }
}

// MARK: - MKMapViewDelegate

extension CarPlayController: MKMapViewDelegate {
  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    if let polyline = overlay as? MKPolyline {
      let renderer = MKPolylineRenderer(polyline: polyline)
      renderer.strokeColor = .systemBlue
      renderer.lineWidth = 6
      return renderer
    }
    return MKOverlayRenderer(overlay: overlay)
  }
}

// MARK: - CPMapTemplateDelegate

extension CarPlayController: CPMapTemplateDelegate {
  func mapTemplate(
    _ mapTemplate: CPMapTemplate,
    panWith direction: CPMapTemplate.PanDirection
  ) {
    guard let map = mapView else { return }
    let camera = map.camera.copy() as! MKMapCamera
    let span = camera.centerCoordinateDistance * 0.0001
    switch direction {
    case .up: camera.centerCoordinate.latitude += span
    case .down: camera.centerCoordinate.latitude -= span
    case .left: camera.centerCoordinate.longitude -= span
    case .right: camera.centerCoordinate.longitude += span
    default: break
    }
    map.setCamera(camera, animated: true)
  }

  func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {
    mapView?.userTrackingMode = .followWithHeading
  }
}

// MARK: - CPSearchTemplateDelegate

extension CarPlayController: CPSearchTemplateDelegate {
  func searchTemplate(
    _ searchTemplate: CPSearchTemplate,
    updatedSearchText searchText: String,
    completionHandler: @escaping ([CPListItem]) -> Void
  ) {
    guard !searchText.isEmpty else {
      completionHandler([])
      return
    }
    self.searchCompletionHandler = completionHandler
    PolarisCarPlay.emitCarPlayEvent("searchQuery", body: ["query": searchText])
  }

  func searchTemplate(
    _ searchTemplate: CPSearchTemplate,
    selectedResult item: CPListItem,
    completionHandler: @escaping () -> Void
  ) {
    if let data = item.userInfo as? [String: Any] {
      PolarisCarPlay.emitCarPlayEvent("searchResultSelected", body: data)
    }
    interfaceController?.popToRootTemplate(animated: true, completion: nil)
    completionHandler()
  }
}
