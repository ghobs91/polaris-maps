import Foundation
import CarPlay
import MapLibre
import MapKit
import UIKit

/// Which CarPlay surface a map host renders into. The dashboard tile is the
/// small secondary map in CarPlay's split view, so it skips the speed-limit
/// overlay; its follow camera matches the full-screen map's heading-up view.
enum CarPlayMapMode {
  case full
  case dashboard
}

/// Hosts a live MapLibre map inside a CarPlay window (the main template or the
/// Dashboard split tile) and draws the active route. Mirrors the phone's
/// navigation view: heading-up pitched follow camera, white-cased blue route
/// line, phone-parity 3D nav puck, destination flag, and a speed-limit
/// overlay. Created
/// lazily on scene connect and torn down on disconnect so the second render
/// target only costs resources while CarPlay is attached.
final class CarPlayMapViewHost: UIViewController, MLNMapViewDelegate {

  let mode: CarPlayMapMode

  init(mode: CarPlayMapMode) {
    self.mode = mode
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  /// Self-contained default style (raster tiles, no remote style document) so a
  /// cold launch from the CarPlay home screen paints a map without a one-shot
  /// style fetch that iOS can abort while the phone app is suspended. JS
  /// replaces it with the phone's resolved style once the bridge attaches.
  private static let defaultStyleJSON = """
    {
      "version": 8,
      "name": "Polaris CarPlay Default",
      "sources": {
        "cartoLight": {
          "type": "raster",
          "tiles": [
            "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"
          ],
          "tileSize": 256,
          "attribution": "© OpenStreetMap contributors © CARTO",
          "maxzoom": 20
        }
      },
      "layers": [
        {
          "id": "carto-light-raster",
          "type": "raster",
          "source": "cartoLight",
          "paint": { "raster-opacity": 1 }
        }
      ]
    }
    """

  /// Phone parity: white casing + cyan core (DEFAULT_ROUTE_COLOR #2FD4F2,
  /// see TrafficRouteLayer).
  private static let routeCoreColor = UIColor(red: 0x2F / 255, green: 0xD4 / 255, blue: 0xF2 / 255, alpha: 1)
  /// Route line widths interpolated by zoom, matching the phone's
  /// `TrafficRouteLayer` / `MapView` stops so the line thins out in the route
  /// overview instead of staying at nav-zoom thickness.
  private static let routeCasingWidthStops: [NSNumber: NSNumber] = [10: 4, 14: 7, 17: 11]
  private static let routeCoreWidthStops: [NSNumber: NSNumber] = [10: 2, 14: 4.5, 17: 7.5]
  private static let alternateWidthStops: [NSNumber: NSNumber] = [10: 2, 14: 4, 17: 6]

  /// A `lineWidth` expression interpolating the given zoom stops linearly.
  private static func zoomWidth(_ stops: [NSNumber: NSNumber]) -> NSExpression {
    NSExpression(
      forMLNInterpolating: NSExpression.zoomLevelVariable,
      curveType: MLNExpressionInterpolationMode.linear,
      parameters: nil,
      stops: NSExpression(forConstantValue: stops))
  }
  private static let baseSourceId = "polaris-route-base"
  private static let alternatesSourceId = "polaris-route-alternates"
  private static let destinationSourceId = "polaris-route-destination"
  private static let destinationImageName = "polaris-destination-flag"
  /// Across-distance in meters approximating the phone's zoom-17 nav camera.
  private static let followDistance: CLLocationDistance = 350
  /// Camera target sits this far ahead of the vehicle so the puck renders low
  /// with route ahead visible (phone uses a 50% top padding for the same).
  private static let forwardOffsetMeters: Double = 100

  private var mapView: MLNMapView?
  private var routeCoordinates: [CLLocationCoordinate2D] = []
  private var alternateCoordinates: [[CLLocationCoordinate2D]] = []
  private var trafficRanges: [RouteTrafficRange] = []
  private var destinationCoordinate: CLLocationCoordinate2D?
  private var installedSourceIds: [String] = []
  private var installedLayerIds: [String] = []
  private var incidentMarkers: [CarPlayIncidentMarker] = []
  private var incidentSourceIds: [String] = []
  private var incidentLayerIds: [String] = []
  private var styleLoaded = false
  private weak var carPlayWindow: UIWindow?
  private var followVehicle = true
  /// True while the camera is fitted to the whole route (preview / overview).
  /// Kept separate from `followVehicle` so dismissing the panning interface —
  /// which CarPlay does when a route-choice panel appears — doesn't snap the
  /// camera back to the vehicle and clobber the whole-route fit.
  private var routeOverviewActive = false
  private var lastHeading: Double = 0
  private var speedSign: SpeedLimitBadge?
  // Map-plane nav puck (phone parity): the same polygon groups the phone's
  // MapView renders, as MapLibre fill layers so the puck tilts and
  // foreshortens with the 3D follow camera instead of a flat screen-space image.
  private var puckBuilt = false
  private var puckSourceIds: [String] = []
  private var puckLayerIds: [String] = []
  private var pendingStyleJson: String?
  private var lastStyleFileURL: URL?

  /// True once a real position has arrived; guards against locating to (0, 0).
  private(set) var hasCenter = false
  /// True while a navigation session is active; switches to the pitched
  /// heading-up follow camera on every surface (full screen and dashboard
  /// tile) and swaps the idle location dot for the nav puck (matching the
  /// phone, which shows the puck only in navigation mode).
  var isNavigating = false {
    didSet {
      if oldValue != isNavigating { updateVehicleMarkers() }
    }
  }

  var currentCoordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)

  /// Seeds the position without moving the camera (used for the route start
  /// before the first GPS fix).
  func seedCoordinate(_ coordinate: CLLocationCoordinate2D) {
    currentCoordinate = coordinate
    hasCenter = true
    // Show the vehicle marker at the route start before the first GPS fix.
    updateVehicleMarkers()
  }

  /// Accepts `UIWindow` (not just `CPWindow`) so the same host serves the main
  /// template scene's `CPWindow` and the Dashboard scene's plain `UIWindow`.
  func activate(in window: UIWindow) {
    guard mapView == nil else { return }
    carPlayWindow = window

    let view = MLNMapView(frame: window.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.delegate = self
    view.showsUserLocation = false
    view.logoView.isHidden = true
    view.attributionButton.isHidden = true
    mapView = view

    self.view = view
    window.rootViewController = self

    // Paint immediately with the self-contained style; JS swaps in the phone
    // style when the bridge attaches.
    applyStyle(json: Self.defaultStyleJSON)

    let badge = SpeedLimitBadge()
    badge.isHidden = true
    if mode == .full {
      window.addSubview(badge)
      speedSign = badge
    }

    layoutOverlays()

    // A style push may have arrived before the map existed; apply it now so
    // first paint already matches the phone.
    if let pending = pendingStyleJson {
      pendingStyleJson = nil
      applyStyle(json: pending)
    }
  }

  func deactivate() {
    clearRoute()
    incidentMarkers = []
    incidentSourceIds = []
    incidentLayerIds = []
    pendingStyleJson = nil
    if let previous = lastStyleFileURL {
      try? FileManager.default.removeItem(at: previous)
    }
    lastStyleFileURL = nil
    styleLoaded = false
    removeVehicleMarkers()
    speedSign?.removeFromSuperview()
    speedSign = nil
    mapView?.delegate = nil
    mapView = nil
    view = nil
    carPlayWindow?.rootViewController = nil
    carPlayWindow = nil
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutOverlays()
  }

  /// Re-asserts the map view as the CarPlay window's content. The system can
  /// clear a `CPWindow`'s root view controller across template transitions,
  /// which leaves the full-screen map blank (the Dashboard's plain `UIWindow`
  /// is unaffected). Safe to call repeatedly.
  func reassertWindowContent() {
    guard let window = carPlayWindow, let view = mapView else { return }
    if window.rootViewController !== self {
      window.rootViewController = self
    } else if view.superview == nil {
      self.view = view
    }
    layoutOverlays()
  }

  /// Called when the CarPlay scene becomes active: re-assert the window content
  /// so a cold launch from the CarPlay home screen isn't left blank by a
  /// template presentation that replaced the window's root view controller.
  func refreshPresentation() {
    reassertWindowContent()
    layoutOverlays()
  }

  /// Applies a MapLibre style JSON (the phone's resolved style) so the
  /// CarPlay map matches the phone map (dark/light mode, satellite). The
  /// JSON is written to a content-tagged file because MLNMapView only
  /// reloads when the style URL changes. Custom route sources/layers are
  /// rebuilt from `didFinishLoading` after the swap.
  func applyStyle(json: String) {
    guard !json.isEmpty else { return }
    guard mapView != nil else {
      pendingStyleJson = json
      return
    }
    var hasher = Hasher()
    hasher.combine(json)
    let tag = String(format: "%08x", UInt32(truncatingIfNeeded: hasher.finalize()))
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "polaris-carplay-style-\(tag).json")
    if url != lastStyleFileURL {
      guard let data = json.data(using: .utf8) else { return }
      do {
        try data.write(to: url, options: .atomic)
      } catch {
        return
      }
      if let previous = lastStyleFileURL {
        try? FileManager.default.removeItem(at: previous)
      }
      lastStyleFileURL = url
      // Park the load flag before swapping; didFinishLoading re-arms it and
      // draws anything pending.
      styleLoaded = false
      mapView?.styleURL = url
    }
  }

  /// Puck stays pinned to the camera focal point (screen center); the speed
  /// sign sits bottom-left above the trip bar, like Google Maps on CarPlay.
  private func layoutOverlays() {
    guard let window = carPlayWindow else { return }
    let bounds = window.bounds
    let inset = window.safeAreaInsets
    speedSign?.frame = CGRect(
      x: inset.left + 12,
      y: bounds.height - inset.bottom - 104,
      width: 52,
      height: 68
    )
  }

  // MARK: Route

  /// Draws the active route (plus destination flag) with MapLibre style layers,
  /// exactly like the phone's `TrafficRouteLayer`. Legacy `MLNPolyline`
  /// annotations never painted reliably in the CarPlay window; style layers do,
  /// and they also survive the phone's style reload.
  func showRoute(
    encodedPolyline: String,
    destination: CLLocationCoordinate2D? = nil,
    alternates: [String] = []
  ) {
    let coordinates = PolylineDecoder.decode(encodedPolyline)
    guard coordinates.count >= 2 else {
      clearRoute()
      return
    }
    routeCoordinates = coordinates
    alternateCoordinates = alternates.compactMap { encoded in
      let decoded = PolylineDecoder.decode(encoded)
      return decoded.count >= 2 ? decoded : nil
    }
    destinationCoordinate = destination
    rebuildRouteLayers()
    // Always show the whole route on a route change (preview/start/selection);
    // follow-camera ticks come through `updateCenter`, not here.
    followVehicle = true
    routeOverviewActive = false
    fitCamera(to: coordinates)
  }

  func clearRoute() {
    routeCoordinates = []
    alternateCoordinates = []
    trafficRanges = []
    destinationCoordinate = nil
    speedSign?.isHidden = true
    removeRouteLayers()
    // Keep the vehicle markers; just drop the puck back to the idle dot.
    updateVehicleMarkers()
  }

  // MARK: Traffic-colored segments (phone's TrafficRouteLayer)

  /// Overlays per-range colored cores on top of the blue fallback. An empty
  /// array restores the plain blue line.
  func showTraffic(_ ranges: [RouteTrafficRange]) {
    trafficRanges = ranges
    rebuildRouteLayers()
  }

  // MARK: Incident markers (phone's IncidentLayer)

  /// Draws crowd-reported incidents as typed symbols. Rebuilt on every style
  /// load so they survive the phone's style push, like the route.
  func showIncidents(_ markers: [CarPlayIncidentMarker]) {
    incidentMarkers = markers
    rebuildIncidentLayers()
  }

  private func rebuildIncidentLayers() {
    guard styleLoaded, let style = mapView?.style else { return }
    removeIncidentLayers()
    var groups: [String: [CLLocationCoordinate2D]] = [:]
    for marker in incidentMarkers {
      groups[marker.type, default: []].append(marker.coordinate)
    }
    for (type, coordinates) in groups {
      let identifier = "polaris-incident-\(type.replacingOccurrences(of: " ", with: "-"))"
      let features: [MLNShape & MLNFeature] = coordinates.map { coordinate in
        let feature = MLNPointFeature()
        feature.coordinate = coordinate
        return feature
      }
      let source = MLNShapeSource(identifier: identifier, features: features, options: nil)
      style.addSource(source)
      incidentSourceIds.append(identifier)
      let imageName = "\(identifier)-icon"
      if let image = Self.incidentBadge(for: type) {
        style.setImage(image, forName: imageName)
      }
      let layer = MLNSymbolStyleLayer(identifier: "\(identifier)-layer", source: source)
      layer.iconImageName = NSExpression(forConstantValue: imageName)
      layer.iconAllowsOverlap = NSExpression(forConstantValue: true)
      layer.iconIgnoresPlacement = NSExpression(forConstantValue: true)
      style.addLayer(layer)
      incidentLayerIds.append(layer.identifier)
    }
    // Keep the puck above the incident symbols.
    rebuildVehicleMarkers()
  }

  private func removeIncidentLayers() {
    guard let style = mapView?.style else {
      incidentSourceIds = []
      incidentLayerIds = []
      return
    }
    for identifier in incidentLayerIds {
      if let layer = style.layer(withIdentifier: identifier) {
        style.removeLayer(layer)
      }
    }
    for identifier in incidentSourceIds {
      if let source = style.source(withIdentifier: identifier) {
        style.removeSource(source)
      }
    }
    incidentSourceIds = []
    incidentLayerIds = []
  }

  // MARK: Nav puck (phone parity)

  /// One source per polygon group of the phone's `navPuckShapes`
  /// (src/components/map/MapView.tsx).
  private static let puckHaloRim = "polaris-puck-halo-rim"
  private static let puckHaloFill = "polaris-puck-halo-fill"
  private static let puckShadowOuter = "polaris-puck-shadow-outer"
  private static let puckShadowInner = "polaris-puck-shadow-inner"
  private static let puckBody = "polaris-puck-body"
  private static let puckTop = "polaris-puck-top"
  /// Idle location dot (shown when not navigating, like the phone's UserLocation).
  private static let locationDot = "polaris-location-dot"

  /// (Re)creates the puck's fill layers on top of the route/incident layers.
  /// A style swap wipes custom sources, so this runs on every style load and
  /// after any route/incident rebuild to keep the puck topmost.
  private func rebuildVehicleMarkers() {
    removeVehicleMarkers()
    guard styleLoaded, let style = mapView?.style else { return }
    let specs: [(id: String, color: UIColor)] = [
      (Self.puckHaloRim, UIColor(red: 0x65 / 255, green: 0xD8 / 255, blue: 0xFF / 255, alpha: 1)),
      (Self.puckHaloFill, UIColor(red: 0, green: 145 / 255, blue: 214 / 255, alpha: 0.38)),
      (Self.puckShadowOuter, UIColor(red: 26 / 255, green: 39 / 255, blue: 61 / 255, alpha: 0.14)),
      (Self.puckShadowInner, UIColor(red: 26 / 255, green: 39 / 255, blue: 61 / 255, alpha: 0.2)),
      (Self.puckBody, UIColor(red: 0xC7 / 255, green: 0xD0 / 255, blue: 0xDB / 255, alpha: 1)),
      (Self.puckTop, .white),
    ]
    for spec in specs {
      let source = MLNShapeSource(identifier: spec.id, shape: nil, options: nil)
      style.addSource(source)
      puckSourceIds.append(spec.id)
      let layer = MLNFillStyleLayer(identifier: "\(spec.id)-fill", source: source)
      layer.fillColor = NSExpression(forConstantValue: spec.color)
      style.addLayer(layer)
      puckLayerIds.append(layer.identifier)
    }

    // Idle location dot: the phone shows the native UserLocation dot when not
    // navigating; the puck replaces it during navigation.
    let dotSource = MLNShapeSource(identifier: Self.locationDot, shape: nil, options: nil)
    style.addSource(dotSource)
    puckSourceIds.append(Self.locationDot)
    let dotLayer = MLNCircleStyleLayer(identifier: "\(Self.locationDot)-circle", source: dotSource)
    dotLayer.circleRadius = NSExpression(forConstantValue: 8)
    dotLayer.circleColor = NSExpression(
      forConstantValue: UIColor(red: 0x0A / 255, green: 0x84 / 255, blue: 0xFF / 255, alpha: 1))
    dotLayer.circleStrokeWidth = NSExpression(forConstantValue: 3)
    dotLayer.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
    style.addLayer(dotLayer)
    puckLayerIds.append(dotLayer.identifier)

    puckBuilt = true
    updateVehicleMarkers()
  }

  private func removeVehicleMarkers() {
    puckBuilt = false
    guard let style = mapView?.style else {
      puckSourceIds = []
      puckLayerIds = []
      return
    }
    for identifier in puckLayerIds {
      if let layer = style.layer(withIdentifier: identifier) {
        style.removeLayer(layer)
      }
    }
    for identifier in puckSourceIds {
      if let source = style.source(withIdentifier: identifier) {
        style.removeSource(source)
      }
    }
    puckSourceIds = []
    puckLayerIds = []
  }

  /// Positions the nav puck (while navigating) or the idle location dot
  /// (otherwise), mirroring the phone's `navigationMode` behavior. Called on
  /// every GPS tick; only the sources' shapes change (no layer churn).
  private func updateVehicleMarkers() {
    guard puckBuilt, hasCenter, let style = mapView?.style, let view = mapView else { return }
    let coordinate = currentCoordinate

    // Not navigating: hide the puck and show the plain location dot.
    guard isNavigating else {
      for id in [
        Self.puckHaloRim, Self.puckHaloFill, Self.puckShadowOuter, Self.puckShadowInner,
        Self.puckBody, Self.puckTop,
      ] {
        clearShape(style, id: id)
      }
      setDotShape(style, coordinate: coordinate)
      return
    }

    setDotShape(style, coordinate: nil)

    // Use the live map scale (meters per screen point) rather than
    // `view.zoomLevel`: the CarPlay follow camera is configured via
    // `acrossDistance`, so its reported zoom doesn't match the phone's zoom-17
    // and would render the puck enormously large.
    let metersPerPoint = view.metersPerPoint(atLatitude: coordinate.latitude)
    let bearing = lastHeading

    // Halo sits on the arrow's bounding-box center; shadow and body shift back
    // to fake depth (mirrors MapView.tsx's build*GeoJSON helpers).
    let haloShiftPx =
      NavPuckGeometry.arrowCenteringPx
      - (NavPuckGeometry.arrowTipPx + NavPuckGeometry.arrowBasePx) / 2
    let haloCenter = NavPuckGeometry.shifted(
      coordinate, bearing: bearing, metersPerPoint: metersPerPoint, backPx: haloShiftPx)
    let shadowCenter = NavPuckGeometry.shifted(
      coordinate, bearing: bearing, metersPerPoint: metersPerPoint,
      backPx: NavPuckGeometry.shadowShiftPx)
    let bodyCenter = NavPuckGeometry.shifted(
      coordinate, bearing: bearing, metersPerPoint: metersPerPoint,
      backPx: NavPuckGeometry.bodyShiftPx)

    setPuckShape(
      style, id: Self.puckHaloRim,
      ring: NavPuckGeometry.ellipseRing(
        center: haloCenter, bearing: bearing, metersPerPoint: metersPerPoint,
        forwardSemiPx: NavPuckGeometry.haloRimForwardPx,
        lateralSemiPx: NavPuckGeometry.haloRimLateralPx))
    setPuckShape(
      style, id: Self.puckHaloFill,
      ring: NavPuckGeometry.ellipseRing(
        center: haloCenter, bearing: bearing, metersPerPoint: metersPerPoint,
        forwardSemiPx: NavPuckGeometry.haloFillForwardPx,
        lateralSemiPx: NavPuckGeometry.haloFillLateralPx))
    setPuckShape(
      style, id: Self.puckShadowOuter,
      ring: NavPuckGeometry.ellipseRing(
        center: shadowCenter, bearing: bearing, metersPerPoint: metersPerPoint,
        forwardSemiPx: NavPuckGeometry.shadowOuterForwardPx,
        lateralSemiPx: NavPuckGeometry.shadowOuterLateralPx))
    setPuckShape(
      style, id: Self.puckShadowInner,
      ring: NavPuckGeometry.ellipseRing(
        center: shadowCenter, bearing: bearing, metersPerPoint: metersPerPoint,
        forwardSemiPx: NavPuckGeometry.shadowInnerForwardPx,
        lateralSemiPx: NavPuckGeometry.shadowInnerLateralPx))
    setPuckShape(
      style, id: Self.puckBody,
      ring: NavPuckGeometry.arrowRing(
        center: bodyCenter, bearing: bearing, metersPerPoint: metersPerPoint,
        scale: NavPuckGeometry.bodyScale))
    setPuckShape(
      style, id: Self.puckTop,
      ring: NavPuckGeometry.arrowRing(
        center: coordinate, bearing: bearing, metersPerPoint: metersPerPoint, scale: 1))
  }

  private func setPuckShape(_ style: MLNStyle, id: String, ring: [CLLocationCoordinate2D]) {
    guard let source = style.source(withIdentifier: id) as? MLNShapeSource else { return }
    var coordinates = ring
    source.shape = MLNPolygon(coordinates: &coordinates, count: UInt(coordinates.count))
  }

  /// Empties a shape source so its layer paints nothing (used to hide the puck).
  private func clearShape(_ style: MLNStyle, id: String) {
    (style.source(withIdentifier: id) as? MLNShapeSource)?.shape = nil
  }

  /// Moves the idle location dot, or hides it when `coordinate` is nil.
  private func setDotShape(_ style: MLNStyle, coordinate: CLLocationCoordinate2D?) {
    guard let source = style.source(withIdentifier: Self.locationDot) as? MLNShapeSource else {
      return
    }
    if let coordinate = coordinate {
      let feature = MLNPointFeature()
      feature.coordinate = coordinate
      source.shape = feature
    } else {
      source.shape = nil
    }
  }

  /// Per-type badge colors, mirroring the phone's `IncidentLayer` TYPE_COLORS.
  private static func incidentColor(for type: String) -> UIColor {
    switch type {
    case "accident": return UIColor(red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255, alpha: 1)
    case "road_closure", "construction":
      return UIColor(red: 0xFF / 255, green: 0x95 / 255, blue: 0x00 / 255, alpha: 1)
    case "hazard": return UIColor(red: 0xFF / 255, green: 0xCC / 255, blue: 0x00 / 255, alpha: 1)
    case "police": return UIColor(red: 0x0A / 255, green: 0x84 / 255, blue: 0xFF / 255, alpha: 1)
    default: return UIColor(red: 0x8E / 255, green: 0x8E / 255, blue: 0x93 / 255, alpha: 1)
    }
  }

  /// SF Symbol glyph per incident type, mirroring the phone's Ionicons mapping.
  private static func incidentGlyph(for type: String) -> String {
    switch type {
    case "accident": return "car.fill"
    case "road_closure": return "nosign"
    case "hazard": return "exclamationmark.triangle.fill"
    case "construction": return "hammer.fill"
    case "police": return "shield.fill"
    default: return "exclamationmark.circle.fill"
    }
  }

  /// 22pt circular badge (per-type color, white border, soft shadow, white
  /// glyph) matching the phone's `IncidentBadge`. Rendered as a symbol image
  /// so it stays a constant screen size like the phone's MarkerView.
  private static func incidentBadge(for type: String) -> UIImage? {
    let size = CGSize(width: 22, height: 22)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      let cg = ctx.cgContext
      let circle = UIBezierPath(ovalIn: CGRect(x: 1.5, y: 1.5, width: 19, height: 19))

      cg.saveGState()
      cg.setShadow(
        offset: CGSize(width: 0, height: 1), blur: 2,
        color: UIColor.black.withAlphaComponent(0.5).cgColor)
      Self.incidentColor(for: type).setFill()
      circle.fill()
      cg.restoreGState()

      UIColor.white.withAlphaComponent(0.85).setStroke()
      circle.lineWidth = 1.5
      circle.stroke()

      if let glyph = UIImage(systemName: Self.incidentGlyph(for: type)), glyph.size.width > 0 {
        let scale = min(13 / glyph.size.width, 13 / glyph.size.height)
        let drawSize = CGSize(width: glyph.size.width * scale, height: glyph.size.height * scale)
        let rect = CGRect(
          x: (size.width - drawSize.width) / 2,
          y: (size.height - drawSize.height) / 2,
          width: drawSize.width,
          height: drawSize.height)
        glyph.withTintColor(.white, renderingMode: .alwaysOriginal).draw(in: rect)
      }
    }
  }

  /// (Re)builds every route layer from the current state. Called on route
  /// start, traffic updates, and every style load — a style swap (dark/light,
  /// satellite) wipes custom sources/layers, so they must be re-added.
  private func rebuildRouteLayers() {
    guard styleLoaded, let style = mapView?.style, !routeCoordinates.isEmpty else { return }
    removeRouteLayers()

    // Grey alternatives first so the active route paints above them (mirrors
    // the phone's `route-alternates` layer).
    if !alternateCoordinates.isEmpty {
      let shapes: [MLNShape] = alternateCoordinates.map { slice in
        var coordinates = slice
        return MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
      }
      let source = MLNShapeSource(
        identifier: Self.alternatesSourceId, shapes: shapes, options: nil)
      style.addSource(source)
      installedSourceIds.append(Self.alternatesSourceId)
      let layer = MLNLineStyleLayer(
        identifier: "\(Self.alternatesSourceId)-line", source: source)
      layer.lineColor = NSExpression(
        forConstantValue: UIColor(red: 0x8E / 255, green: 0x8E / 255, blue: 0x93 / 255, alpha: 1))
      layer.lineWidth = Self.zoomWidth(Self.alternateWidthStops)
      layer.lineOpacity = NSExpression(forConstantValue: 0.6)
      layer.lineCap = NSExpression(forConstantValue: "round")
      layer.lineJoin = NSExpression(forConstantValue: "round")
      style.addLayer(layer)
      installedLayerIds.append(layer.identifier)
    }

    var baseCoordinates = routeCoordinates
    let baseShape = MLNPolyline(
      coordinates: &baseCoordinates, count: UInt(baseCoordinates.count))
    let baseSource = MLNShapeSource(identifier: Self.baseSourceId, shape: baseShape, options: nil)
    style.addSource(baseSource)
    installedSourceIds.append(Self.baseSourceId)

    let hasTraffic = !trafficRanges.isEmpty
    var groups: [String: (color: UIColor, slices: [[CLLocationCoordinate2D]])] = [:]
    for range in trafficRanges {
      let from = max(0, range.from)
      let to = min(routeCoordinates.count - 1, range.to)
      guard to > from else { continue }
      var group = groups[range.hex] ?? (range.color, [])
      group.slices.append(Array(routeCoordinates[from...to]))
      groups[range.hex] = group
    }

    var trafficSources: [(UIColor, MLNShapeSource)] = []
    for (hex, group) in groups {
      let shapes: [MLNShape] = group.slices.map { slice in
        var coordinates = slice
        return MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
      }
      guard !shapes.isEmpty else { continue }
      let identifier = "polaris-route-traffic-\(hex.replacingOccurrences(of: "#", with: ""))"
      let source = MLNShapeSource(identifier: identifier, shapes: shapes, options: nil)
      style.addSource(source)
      installedSourceIds.append(identifier)
      trafficSources.append((group.color, source))
    }

    var destinationSource: MLNShapeSource?
    if let destination = destinationCoordinate {
      let feature = MLNPointFeature()
      feature.coordinate = destination
      let source = MLNShapeSource(
        identifier: Self.destinationSourceId, shape: feature, options: nil)
      style.addSource(source)
      installedSourceIds.append(Self.destinationSourceId)
      destinationSource = source
    }

    // Casing layers first so every colored core paints above every casing.
    addLineLayer(
      identifier: "polaris-route-base-casing",
      source: baseSource,
      color: .white,
      opacity: hasTraffic ? 0 : 1,
      width: Self.zoomWidth(Self.routeCasingWidthStops),
      style: style
    )
    for (_, source) in trafficSources {
      addLineLayer(
        identifier: "\(source.identifier)-casing",
        source: source,
        color: .white,
        opacity: 1,
        width: Self.zoomWidth(Self.routeCasingWidthStops),
        style: style
      )
    }

    addLineLayer(
      identifier: "polaris-route-base-core",
      source: baseSource,
      color: Self.routeCoreColor,
      opacity: hasTraffic ? 0 : 1,
      width: Self.zoomWidth(Self.routeCoreWidthStops),
      style: style
    )
    for (color, source) in trafficSources {
      addLineLayer(
        identifier: "\(source.identifier)-core",
        source: source,
        color: color,
        opacity: 1,
        width: Self.zoomWidth(Self.routeCoreWidthStops),
        style: style
      )
    }

    if let source = destinationSource {
      if let flag = UIImage(systemName: "flag.checkered")?
        .withTintColor(Self.routeCoreColor, renderingMode: .alwaysOriginal)
      {
        style.setImage(flag, forName: Self.destinationImageName)
      }
      let symbol = MLNSymbolStyleLayer(
        identifier: "polaris-route-destination-symbol", source: source)
      symbol.iconImageName = NSExpression(forConstantValue: Self.destinationImageName)
      symbol.iconAnchor = NSExpression(forConstantValue: "bottom")
      symbol.iconAllowsOverlap = NSExpression(forConstantValue: true)
      symbol.iconIgnoresPlacement = NSExpression(forConstantValue: true)
      style.addLayer(symbol)
      installedLayerIds.append(symbol.identifier)
    }

    // Re-add the puck above the route layers just rebuilt.
    rebuildVehicleMarkers()
  }

  private func addLineLayer(
    identifier: String,
    source: MLNSource,
    color: UIColor,
    opacity: Double,
    width: NSExpression,
    style: MLNStyle
  ) {
    let layer = MLNLineStyleLayer(identifier: identifier, source: source)
    layer.lineColor = NSExpression(forConstantValue: color)
    layer.lineWidth = width
    layer.lineOpacity = NSExpression(forConstantValue: opacity)
    layer.lineCap = NSExpression(forConstantValue: "round")
    layer.lineJoin = NSExpression(forConstantValue: "round")
    style.addLayer(layer)
    installedLayerIds.append(identifier)
  }

  private func removeRouteLayers() {
    guard let style = mapView?.style else {
      installedSourceIds = []
      installedLayerIds = []
      return
    }
    for identifier in installedLayerIds {
      if let layer = style.layer(withIdentifier: identifier) {
        style.removeLayer(layer)
      }
    }
    for identifier in installedSourceIds {
      if let source = style.source(withIdentifier: identifier) {
        style.removeSource(source)
      }
    }
    installedSourceIds = []
    installedLayerIds = []
  }

  // MARK: Camera

  /// Zoom used when not actively navigating (locate, dashboard tile).
  private static let idleZoom: Double = 15

  func updateCenter(lat: Double, lng: Double, heading: Double) {
    // (0, 0) is the Atlantic off West Africa — never a real fix. Ignoring it
    // keeps the pre-fix default from parking the map in "blank ocean".
    if lat == 0 && lng == 0 { return }
    currentCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    hasCenter = true
    lastHeading = heading
    // Move the follow camera first so the puck is sized from the camera that's
    // actually in effect. Updating markers before the camera made a recenter
    // redraw the puck at the panned/zoomed-out scale.
    if let view = mapView, followVehicle {
      applyFollowCamera(view, heading: heading)
    }
    updateVehicleMarkers()
  }

  private func applyFollowCamera(_ view: MLNMapView, heading: Double) {
    if isNavigating {
      // Heading-up pitched follow camera (phone: zoom 17, pitch 60), shared by
      // the full-screen map and the dashboard split tile so both face the
      // direction of travel like the phone. The target is pushed ahead of the
      // vehicle so the puck sits low with the road ahead in view.
      let target = coordinate(
        from: currentCoordinate, distanceMeters: Self.forwardOffsetMeters, bearing: heading)
      view.camera = MLNMapCamera(
        lookingAtCenter: target,
        acrossDistance: Self.followDistance,
        pitch: 60,
        heading: heading
      )
    } else {
      // Idle locate: flat, north-up, centered.
      view.setCenter(currentCoordinate, zoomLevel: Self.idleZoom, direction: 0, animated: false)
    }
  }

  func recenter() {
    followVehicle = true
    routeOverviewActive = false
    guard let view = mapView, hasCenter else { return }
    applyFollowCamera(view, heading: lastHeading)
    // Re-size the puck for the follow camera immediately; otherwise it keeps
    // the panned/zoomed-out scale until the next GPS tick.
    updateVehicleMarkers()
  }

  /// True while the camera tracks the vehicle. CarPlay gesture callbacks clear
  /// this so a look-around isn't snapped back by the next GPS tick.
  var isFollowing: Bool { followVehicle }

  /// True while the camera is fitted to the whole route (preview / overview).
  var isRouteOverviewActive: Bool { routeOverviewActive }

  /// Fits the whole route and stops following, for the overview control.
  func showRouteOverview() {
    guard !routeCoordinates.isEmpty else { return }
    followVehicle = false
    routeOverviewActive = true
    fitCamera(to: routeCoordinates)
  }

  /// Fits the whole active route for the trip preview, insetting the left edge
  /// so the route isn't hidden behind CarPlay's route-choice panel. Used when
  /// the panel appears over the map and can otherwise snap the camera back to
  /// the vehicle.
  func fitRouteOverview(leftInsetFraction: CGFloat = 0) {
    guard !routeCoordinates.isEmpty else { return }
    followVehicle = false
    routeOverviewActive = true
    fitCamera(to: routeCoordinates, leftInsetFraction: leftInsetFraction)
  }

  func beginUserInteraction() {
    followVehicle = false
  }

  /// Rotaries/edge presses arrive as discrete pan directions. Move the viewport
  /// by a fixed screen delta, matching the system's step feel.
  func pan(direction: CPMapTemplate.PanDirection) {
    guard let view = mapView else { return }
    followVehicle = false
    routeOverviewActive = false
    let step: CGFloat = 140
    var offset = CGPoint.zero
    if direction.contains(.left) { offset.x += step }
    if direction.contains(.right) { offset.x -= step }
    if direction.contains(.up) { offset.y += step }
    if direction.contains(.down) { offset.y -= step }
    guard offset != .zero else { return }
    let center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
    view.centerCoordinate = view.convert(
      CGPoint(x: center.x + offset.x, y: center.y + offset.y), toCoordinateFrom: view)
  }

  /// Touch pan gestures deliver a screen-space translation; follow it exactly.
  func pan(byScreenTranslation translation: CGPoint) {
    guard let view = mapView else { return }
    followVehicle = false
    routeOverviewActive = false
    let center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
    view.centerCoordinate = view.convert(
      CGPoint(x: center.x - translation.x, y: center.y - translation.y), toCoordinateFrom: view)
  }

  // MARK: Continuous gestures (iOS 26 touch surfaces)

  private var lastGestureScale: CGFloat = 1
  private var lastGestureRotation: CGFloat = 0

  func resetGestureTracking() {
    lastGestureScale = 1
    lastGestureRotation = 0
  }

  func applyZoomGesture(scale: CGFloat) {
    guard let view = mapView, scale > 0 else { return }
    followVehicle = false
    routeOverviewActive = false
    let delta = scale / lastGestureScale
    lastGestureScale = scale
    view.zoomLevel = min(max(view.zoomLevel + log2(Double(delta)), 3), 19)
  }

  func applyRotationGesture(rotation: CGFloat) {
    guard let view = mapView else { return }
    followVehicle = false
    routeOverviewActive = false
    let delta = rotation - lastGestureRotation
    lastGestureRotation = rotation
    view.direction = (view.direction + Double(delta) * 180 / .pi)
      .truncatingRemainder(dividingBy: 360)
  }

  private func coordinate(
    from origin: CLLocationCoordinate2D, distanceMeters: Double, bearing: Double
  ) -> CLLocationCoordinate2D {
    let radius = 6_371_000.0
    let bearingRad = bearing * .pi / 180
    let latRad = origin.latitude * .pi / 180
    let lngRad = origin.longitude * .pi / 180
    let angular = distanceMeters / radius
    let newLat = asin(sin(latRad) * cos(angular) + cos(latRad) * sin(angular) * cos(bearingRad))
    let newLng = lngRad
      + atan2(
        sin(bearingRad) * sin(angular) * cos(latRad),
        cos(angular) - sin(latRad) * sin(newLat)
      )
    return CLLocationCoordinate2D(latitude: newLat * 180 / .pi, longitude: newLng * 180 / .pi)
  }

  func zoom(by factor: Double) {
    guard let view = mapView else { return }
    view.zoomLevel = min(max(view.zoomLevel + log2(factor), 3), 19)
  }

  private func fitCamera(
    to coordinates: [CLLocationCoordinate2D], leftInsetFraction: CGFloat = 0
  ) {
    guard let view = mapView, !coordinates.isEmpty else { return }
    var rect = MKMapRect.null
    for coordinate in coordinates {
      let point = MKMapPoint(coordinate)
      rect = rect.union(MKMapRect(origin: point, size: MKMapSize(width: 0, height: 0)))
    }
    var bounds = MLNCoordinateBounds(sw: coordinates[0], ne: coordinates[0])
    for coordinate in coordinates {
      bounds = MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(
          latitude: min(bounds.sw.latitude, coordinate.latitude),
          longitude: min(bounds.sw.longitude, coordinate.longitude)),
        ne: CLLocationCoordinate2D(
          latitude: max(bounds.ne.latitude, coordinate.latitude),
          longitude: max(bounds.ne.longitude, coordinate.longitude))
      )
    }
    // Inset the left edge so the route clears CarPlay's route-choice panel.
    let leftPadding = 60 + (leftInsetFraction > 0 ? view.bounds.width * leftInsetFraction : 0)
    view.setVisibleCoordinateBounds(
      bounds,
      edgePadding: UIEdgeInsets(top: 80, left: leftPadding, bottom: 80, right: 60),
      animated: true,
      completionHandler: nil
    )
  }

  // MARK: Speed limit overlay (phone's SpeedLimitSign, MUTCD style)

  func showSpeedLimit(value: Double?, unit: String) {
    guard let badge = speedSign else { return }
    guard let value = value, value > 0 else {
      badge.isHidden = true
      return
    }
    badge.speed = Int(value.rounded())
    badge.isHidden = false
  }

  // MARK: MLNMapViewDelegate

  func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    styleLoaded = true
    rebuildRouteLayers()
    rebuildIncidentLayers()
  }

  func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
    // Never leave a route parked forever behind a failed style: sources and
    // layers can still be added and will paint if tiles arrive later.
    styleLoaded = true
    rebuildRouteLayers()
    rebuildIncidentLayers()
  }
}

/// Map-plane geometry for the phone-parity nav puck. Ported from
/// src/components/map/MapView.tsx (`buildArrowRing`, `buildEllipseRing`,
/// `roundedPolygonRing`) so CarPlay draws the identical 3D arrow + halo +
/// shadow the phone does.
enum NavPuckGeometry {
  // Screen-pixel sizes (MapView.tsx ARROW_* / HALO_* / BODY_* / SHADOW_*).
  static let arrowTipPx = 12.0
  static let arrowBasePx = -10.0
  static let arrowHalfWidthPx = 9.0
  static let arrowNotchPx = -6.0
  static let arrowTipRadiusPx = 4.0
  static let arrowBaseRadiusPx = 3.0
  static let arrowNotchRadiusPx = 2.0
  static let arrowCenteringPx = 1.5
  static let bodyShiftPx = 2.0
  static let bodyScale = 1.06
  static let shadowShiftPx = 2.0
  static let haloRimForwardPx = 20.0
  static let haloRimLateralPx = 16.0
  static let haloFillForwardPx = 18.0
  static let haloFillLateralPx = 14.0
  static let shadowOuterForwardPx = 12.0
  static let shadowOuterLateralPx = 9.0
  static let shadowInnerForwardPx = 9.0
  static let shadowInnerLateralPx = 7.0

  private static func metersPerDegree(lat: Double) -> (lat: Double, lng: Double) {
    let mPerDegLat = 111320.0
    return (mPerDegLat, mPerDegLat * cos(lat * .pi / 180))
  }

  /// Offsets a coordinate backwards along `bearing` by `backPx` screen points.
  static func shifted(
    _ coordinate: CLLocationCoordinate2D, bearing: Double, metersPerPoint: Double, backPx: Double
  ) -> CLLocationCoordinate2D {
    let m = metersPerDegree(lat: coordinate.latitude)
    let shiftM = backPx * metersPerPoint
    let rad = bearing * .pi / 180
    return CLLocationCoordinate2D(
      latitude: coordinate.latitude - shiftM * cos(rad) / m.lat,
      longitude: coordinate.longitude - shiftM * sin(rad) / m.lng)
  }

  /// The chunky rounded arrow with a concave base notch (phone's buildArrowRing).
  static func arrowRing(
    center: CLLocationCoordinate2D, bearing: Double, metersPerPoint: Double, scale: Double
  ) -> [CLLocationCoordinate2D] {
    let points: [(Double, Double)] = [
      (arrowTipPx, 0),
      (arrowBasePx, arrowHalfWidthPx),
      (arrowNotchPx, 0),
      (arrowBasePx, -arrowHalfWidthPx),
    ]
    let radii = [arrowTipRadiusPx, arrowBaseRadiusPx, arrowNotchRadiusPx, arrowBaseRadiusPx]
    let rounded = roundedPolygonRing(points: points, radii: radii, samplesPerCorner: 6)
    return project(
      center: center, bearing: bearing, metersPerPoint: metersPerPoint, points: rounded,
      scale: scale, forwardOffsetPx: arrowCenteringPx)
  }

  /// A foreshortened ellipse (phone's buildEllipseRing) for the halo/shadow.
  static func ellipseRing(
    center: CLLocationCoordinate2D, bearing: Double, metersPerPoint: Double,
    forwardSemiPx: Double, lateralSemiPx: Double
  ) -> [CLLocationCoordinate2D] {
    let steps = 32
    var points: [(Double, Double)] = []
    for i in 0..<steps {
      let theta = Double(i) / Double(steps) * 2 * .pi
      points.append((forwardSemiPx * cos(theta), lateralSemiPx * sin(theta)))
    }
    return project(
      center: center, bearing: bearing, metersPerPoint: metersPerPoint, points: points, scale: 1,
      forwardOffsetPx: 0)
  }

  /// Projects screen-space (forward, lateral) point offsets into a map-plane ring.
  /// `metersPerPoint` comes from the live map view so the puck stays a constant
  /// screen size regardless of how the camera was configured (CarPlay's follow
  /// camera uses `acrossDistance`, whose `zoomLevel` doesn't match the phone's).
  private static func project(
    center: CLLocationCoordinate2D, bearing: Double, metersPerPoint: Double,
    points: [(Double, Double)], scale: Double, forwardOffsetPx: Double
  ) -> [CLLocationCoordinate2D] {
    let m = metersPerDegree(lat: center.latitude)
    let rad = bearing * .pi / 180
    let perp = rad + .pi / 2
    var ring: [CLLocationCoordinate2D] = points.map { forwardPx, lateralPx in
      let forwardM = (forwardPx - forwardOffsetPx) * scale * metersPerPoint
      let lateralM = lateralPx * scale * metersPerPoint
      return CLLocationCoordinate2D(
        latitude: center.latitude + (forwardM * cos(rad) + lateralM * cos(perp)) / m.lat,
        longitude: center.longitude + (forwardM * sin(rad) + lateralM * sin(perp)) / m.lng)
    }
    if let first = ring.first { ring.append(first) }
    return ring
  }

  /// Quadratic-Bezier corner fillet (phone's roundedPolygonRing).
  private static func roundedPolygonRing(
    points: [(Double, Double)], radii: [Double], samplesPerCorner: Int
  ) -> [(Double, Double)] {
    var ring: [(Double, Double)] = []
    let n = points.count
    for i in 0..<n {
      let prev = points[(i - 1 + n) % n]
      let cur = points[i]
      let next = points[(i + 1) % n]
      let prevDist = hypot(prev.0 - cur.0, prev.1 - cur.1)
      let nextDist = hypot(next.0 - cur.0, next.1 - cur.1)
      let r = min(radii[i], prevDist / 2, nextDist / 2)
      let p0 = (
        cur.0 + (prev.0 - cur.0) / prevDist * r, cur.1 + (prev.1 - cur.1) / prevDist * r)
      let p1 = (
        cur.0 + (next.0 - cur.0) / nextDist * r, cur.1 + (next.1 - cur.1) / nextDist * r)
      for s in 0...samplesPerCorner {
        let t = Double(s) / Double(samplesPerCorner)
        let mt = 1 - t
        ring.append((
          mt * mt * p0.0 + 2 * mt * t * cur.0 + t * t * p1.0,
          mt * mt * p0.1 + 2 * mt * t * cur.1 + t * t * p1.1))
      }
    }
    return ring
  }
}

/// Speed limit badge for the CarPlay window. Mirrors the phone's
/// `SpeedLimitSign` component exactly: a 52×68 white sign with a 3pt black
/// border, 6pt corner radius, 8pt "SPEED"/"LIMIT" labels and a 24pt limit
/// number, plus the same soft drop shadow.
final class SpeedLimitBadge: UIView {
  var speed: Int = 0 {
    didSet { setNeedsDisplay() }
  }

  init() {
    super.init(frame: .zero)
    backgroundColor = .clear
    isOpaque = false
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.3
    layer.shadowRadius = 4
    layer.shadowOffset = CGSize(width: 0, height: 2)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let sign = rect.insetBy(dx: 2, dy: 2)
    ctx.setFillColor(UIColor.white.cgColor)
    ctx.setStrokeColor(UIColor.black.cgColor)
    ctx.setLineWidth(3)
    let path = UIBezierPath(roundedRect: sign, cornerRadius: 6)
    ctx.addPath(path.cgPath)
    ctx.drawPath(using: .fillStroke)

    let label = "SPEED\nLIMIT" as NSString
    label.draw(
      in: CGRect(x: sign.minX, y: sign.minY + 4, width: sign.width, height: 20),
      withAttributes: [
        .font: UIFont.systemFont(ofSize: 8, weight: .heavy),
        .foregroundColor: UIColor.black,
        .paragraphStyle: centered(),
      ])

    let value = "\(speed)" as NSString
    value.draw(
      in: CGRect(x: sign.minX, y: sign.minY + 24, width: sign.width, height: 30),
      withAttributes: [
        .font: UIFont.systemFont(ofSize: 24, weight: .heavy),
        .foregroundColor: UIColor.black,
        .paragraphStyle: centered(),
      ])
  }

  private func centered() -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    return style
  }
}

/// Decodes Google-encoded polylines (Valhalla shapes use a precision of 1e6).
enum PolylineDecoder {
  static func decode(_ encoded: String, precision: Double = 1e6) -> [CLLocationCoordinate2D] {
    var coordinates: [CLLocationCoordinate2D] = []
    let chars = Array(encoded.utf8)
    var index = 0

    func nextValue() -> Int32 {
      var result: Int32 = 0
      var shift = 0
      while index < chars.count {
        let byte = Int32(chars[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte & 0x20 == 0 { break }
      }
      return result
    }

    var lat: Int32 = 0
    var lng: Int32 = 0
    while index < chars.count {
      let dLat = nextValue()
      let dLng = nextValue()
      // Zig-zag decode, matching src/utils/polyline.ts:
      // odd deltas are negative (~x), even deltas positive (x).
      lat += (dLat & 1) != 0 ? ~(dLat >> 1) : (dLat >> 1)
      lng += (dLng & 1) != 0 ? ~(dLng >> 1) : (dLng >> 1)
      coordinates.append(
        CLLocationCoordinate2D(
          latitude: Double(lat) / precision,
          longitude: Double(lng) / precision
        )
      )
    }
    return coordinates
  }
}
