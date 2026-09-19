import Foundation
import CarPlay
import MapLibre
import MapKit
import UIKit

/// Hosts a live MapLibre map inside the CarPlay window and draws the active
/// route. Mirrors the phone's navigation view: heading-up pitched follow
/// camera, white-cased blue route line, chevron puck, destination flag, and a
/// speed-limit overlay. Created lazily on scene connect and torn down on
/// disconnect so the second render target only costs resources while CarPlay
/// is attached.
final class CarPlayMapViewHost: UIViewController, MLNMapViewDelegate {

  /// Same default style as the phone-side light map (src/constants/config.ts).
  private static let styleURL = URL(string: "https://tiles.openfreemap.org/styles/liberty")!

  /// Phone parity: white casing + cyan core (DEFAULT_ROUTE_COLOR #2FD4F2,
  /// see TrafficRouteLayer).
  private static let routeCoreColor = UIColor(red: 0x2F / 255, green: 0xD4 / 255, blue: 0xF2 / 255, alpha: 1)
  /// Route line widths. The CarPlay follow camera stays at the phone's nav
  /// zoom, so the phone's zoom-17 stops (11 / 7.5) are used directly.
  private static let routeCasingWidth: Double = 11
  private static let routeCoreWidth: Double = 7.5
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
  private weak var carPlayWindow: CPWindow?
  private var followVehicle = true
  private var lastHeading: Double = 0
  private var puckView: UIImageView?
  private var speedSign: SpeedLimitBadge?
  private var pendingStyleJson: String?
  private var lastStyleFileURL: URL?

  var currentCoordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)

  func activate(in window: CPWindow) {
    guard mapView == nil else { return }
    carPlayWindow = window

    let view = MLNMapView(frame: window.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.styleURL = Self.styleURL
    view.delegate = self
    view.showsUserLocation = false
    view.logoView.isHidden = true
    view.attributionButton.isHidden = true
    mapView = view

    self.view = view
    window.rootViewController = self

    let puck = UIImageView(image: NavPuckImage.make())
    puck.contentMode = .center
    puck.isHidden = true
    window.addSubview(puck)
    puckView = puck

    let badge = SpeedLimitBadge()
    badge.isHidden = true
    window.addSubview(badge)
    speedSign = badge

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
    puckView?.removeFromSuperview()
    puckView = nil
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
    if let puck = puckView, let image = puck.image {
      puck.frame = CGRect(
        x: bounds.midX - image.size.width / 2,
        y: bounds.midY - image.size.height / 2,
        width: image.size.width,
        height: image.size.height
      )
    }
    speedSign?.frame = CGRect(
      x: inset.left + 12,
      y: bounds.height - inset.bottom - 108,
      width: 56,
      height: 72
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
    puckView?.isHidden = false
    rebuildRouteLayers()
    if followVehicle {
      fitCamera(to: coordinates)
    }
  }

  func clearRoute() {
    routeCoordinates = []
    alternateCoordinates = []
    trafficRanges = []
    destinationCoordinate = nil
    puckView?.isHidden = true
    speedSign?.isHidden = true
    removeRouteLayers()
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
      if let image = Self.incidentSymbol(for: type) {
        style.setImage(image, forName: imageName)
      }
      let layer = MLNSymbolStyleLayer(identifier: "\(identifier)-layer", source: source)
      layer.iconImageName = NSExpression(forConstantValue: imageName)
      layer.iconAllowsOverlap = NSExpression(forConstantValue: true)
      layer.iconIgnoresPlacement = NSExpression(forConstantValue: true)
      style.addLayer(layer)
      incidentLayerIds.append(layer.identifier)
    }
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

  /// SF Symbol per incident type, mirroring the phone's `INCIDENT_TYPE_ICONS`.
  private static func incidentSymbol(for type: String) -> UIImage? {
    let name: String
    switch type {
    case "accident": name = "car.fill"
    case "road_closure": name = "nosign"
    case "hazard": name = "exclamationmark.triangle.fill"
    case "construction": name = "hammer.fill"
    case "police": name = "shield.fill"
    default: name = "exclamationmark.circle.fill"
    }
    return UIImage(systemName: name)?
      .withTintColor(.systemRed, renderingMode: .alwaysOriginal)
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
      layer.lineWidth = NSExpression(forConstantValue: 6.0)
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
      width: Self.routeCasingWidth,
      style: style
    )
    for (_, source) in trafficSources {
      addLineLayer(
        identifier: "\(source.identifier)-casing",
        source: source,
        color: .white,
        opacity: 1,
        width: Self.routeCasingWidth,
        style: style
      )
    }

    addLineLayer(
      identifier: "polaris-route-base-core",
      source: baseSource,
      color: Self.routeCoreColor,
      opacity: hasTraffic ? 0 : 1,
      width: Self.routeCoreWidth,
      style: style
    )
    for (color, source) in trafficSources {
      addLineLayer(
        identifier: "\(source.identifier)-core",
        source: source,
        color: color,
        opacity: 1,
        width: Self.routeCoreWidth,
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
  }

  private func addLineLayer(
    identifier: String,
    source: MLNSource,
    color: UIColor,
    opacity: Double,
    width: Double,
    style: MLNStyle
  ) {
    let layer = MLNLineStyleLayer(identifier: identifier, source: source)
    layer.lineColor = NSExpression(forConstantValue: color)
    layer.lineWidth = NSExpression(forConstantValue: width)
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

  func updateCenter(lat: Double, lng: Double, heading: Double) {
    currentCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    lastHeading = heading
    guard let view = mapView, followVehicle else { return }
    // Heading-up pitched follow camera (phone: zoom 17, pitch 60). The
    // target is pushed ahead of the vehicle so the puck sits low with the
    // road ahead in view.
    let target = coordinate(
      from: currentCoordinate, distanceMeters: Self.forwardOffsetMeters, bearing: heading)
    let camera = MLNMapCamera(
      lookingAtCenter: target,
      acrossDistance: Self.followDistance,
      pitch: 60,
      heading: heading
    )
    view.camera = camera
  }

  func recenter() {
    followVehicle = true
    guard mapView != nil else { return }
    updateCenter(
      lat: currentCoordinate.latitude, lng: currentCoordinate.longitude, heading: lastHeading)
  }

  /// True while the camera tracks the vehicle. CarPlay gesture callbacks clear
  /// this so a look-around isn't snapped back by the next GPS tick.
  var isFollowing: Bool { followVehicle }

  /// Fits the whole route and stops following, for the overview control.
  func showRouteOverview() {
    guard !routeCoordinates.isEmpty else { return }
    followVehicle = false
    fitCamera(to: routeCoordinates)
  }

  func beginUserInteraction() {
    followVehicle = false
  }

  /// Rotaries/edge presses arrive as discrete pan directions. Move the viewport
  /// by a fixed screen delta, matching the system's step feel.
  func pan(direction: CPMapTemplate.PanDirection) {
    guard let view = mapView else { return }
    followVehicle = false
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
    let delta = scale / lastGestureScale
    lastGestureScale = scale
    view.zoomLevel = min(max(view.zoomLevel + log2(Double(delta)), 3), 19)
  }

  func applyRotationGesture(rotation: CGFloat) {
    guard let view = mapView else { return }
    followVehicle = false
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

  private func fitCamera(to coordinates: [CLLocationCoordinate2D]) {
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
    view.setVisibleCoordinateBounds(
      bounds,
      edgePadding: UIEdgeInsets(top: 80, left: 60, bottom: 80, right: 60),
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
    badge.unit = unit
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

/// White navigation chevron with a dark outline, matching the phone's nav puck.
/// The follow camera is always heading-up, so the puck points straight up.
enum NavPuckImage {
  static func make() -> UIImage {
    let size = CGSize(width: 34, height: 34)
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      let arrow = CGMutablePath()
      arrow.move(to: CGPoint(x: 17, y: 2))
      arrow.addLine(to: CGPoint(x: 29, y: 24))
      arrow.addLine(to: CGPoint(x: 17, y: 18.5))
      arrow.addLine(to: CGPoint(x: 5, y: 24))
      arrow.closeSubpath()
      ctx.cgContext.setFillColor(UIColor.white.cgColor)
      ctx.cgContext.addPath(arrow)
      ctx.cgContext.fillPath()
      ctx.cgContext.setStrokeColor(UIColor(white: 0.15, alpha: 0.9).cgColor)
      ctx.cgContext.setLineWidth(2)
      ctx.cgContext.setLineJoin(.round)
      ctx.cgContext.addPath(arrow)
      ctx.cgContext.strokePath()
    }
  }
}

/// Speed limit badge for the CarPlay window. Mirrors the phone's
/// `SpeedLimitSign` component (white sign, black border, limit number) with a
/// unit caption so metric limits read correctly ("40 km/h").
final class SpeedLimitBadge: UIView {
  var speed: Int = 0 {
    didSet { setNeedsDisplay() }
  }

  var unit: String = "mph" {
    didSet { setNeedsDisplay() }
  }

  init() {
    super.init(frame: .zero)
    backgroundColor = .clear
    isOpaque = false
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
        .font: UIFont.systemFont(ofSize: 7, weight: .bold),
        .foregroundColor: UIColor.black,
        .paragraphStyle: centered(),
      ])

    let value = "\(speed)" as NSString
    value.draw(
      in: CGRect(x: sign.minX, y: sign.minY + 22, width: sign.width, height: 28),
      withAttributes: [
        .font: UIFont.systemFont(ofSize: 22, weight: .heavy),
        .foregroundColor: UIColor.black,
        .paragraphStyle: centered(),
      ])

    (unit as NSString).draw(
      in: CGRect(x: sign.minX, y: sign.maxY - 14, width: sign.width, height: 12),
      withAttributes: [
        .font: UIFont.systemFont(ofSize: 8, weight: .semibold),
        .foregroundColor: UIColor.darkGray,
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
