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

  /// Phone parity: white casing + #4A8CFF core (see TrafficRouteLayer).
  private static let routeCoreColor = UIColor(red: 0x4A / 255, green: 0x8C / 255, blue: 1, alpha: 1)
  /// Across-distance in meters approximating the phone's zoom-17 nav camera.
  private static let followDistance: CLLocationDistance = 350
  /// Camera target sits this far ahead of the vehicle so the puck renders low
  /// with route ahead visible (phone uses a 50% top padding for the same).
  private static let forwardOffsetMeters: Double = 100

  private var mapView: MLNMapView?
  private var routeCasing: MLNPolyline?
  private var routeCore: MLNPolyline?
  private var trafficCores: [MLNPolyline] = []
  private var routeCoordinates: [CLLocationCoordinate2D] = []
  private var destinationMark: MLNPointAnnotation?
  private var pendingPolyline: String?
  private var pendingDestination: CLLocationCoordinate2D?
  private var pendingTraffic: [RouteTrafficRange]?
  private var styleLoaded = false
  private weak var carPlayWindow: CPWindow?
  private var followVehicle = true
  private var lastHeading: Double = 0
  private var puckView: UIImageView?
  private var speedSign: SpeedLimitBadge?

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
  }

  func deactivate() {
    clearRoute()
    pendingPolyline = nil
    pendingDestination = nil
    pendingTraffic = nil
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

  func showRoute(encodedPolyline: String, destination: CLLocationCoordinate2D? = nil) {
    // The style may still be loading when navigation starts. Park the
    // polyline and draw it from `mapView(_:didFinishLoading:)` — otherwise
    // the route silently never appears.
    pendingPolyline = encodedPolyline
    pendingDestination = destination
    guard styleLoaded else { return }
    drawPendingRoute()
  }

  private func drawPendingRoute() {
    guard let view = mapView, let encoded = pendingPolyline else { return }
    pendingPolyline = nil
    // Capture before clearRoute() resets the pending state.
    let stashedTraffic = pendingTraffic
    clearRoute()

    let coordinates = PolylineDecoder.decode(encoded)
    guard coordinates.count >= 2 else { return }
    routeCoordinates = coordinates

    var mutable = coordinates
    let casing = MLNPolyline(coordinates: &mutable, count: UInt(mutable.count))
    casing.title = "route-casing"
    routeCasing = casing
    view.addAnnotation(casing)

    var mutableCore = coordinates
    let core = MLNPolyline(coordinates: &mutableCore, count: UInt(mutableCore.count))
    core.title = "route-core"
    routeCore = core
    view.addAnnotation(core)

    if let destination = pendingDestination {
      pendingDestination = nil
      let mark = MLNPointAnnotation()
      mark.coordinate = destination
      mark.title = "destination"
      destinationMark = mark
      view.addAnnotation(mark)
    }

    puckView?.isHidden = false
    if let traffic = stashedTraffic {
      drawTrafficCores(traffic)
    }
    if followVehicle {
      fitCamera(to: coordinates)
    }
  }

  func clearRoute() {
    pendingPolyline = nil
    pendingDestination = nil
    pendingTraffic = nil
    puckView?.isHidden = true
    speedSign?.isHidden = true
    routeCoordinates = []
    guard let view = mapView else {
      routeCasing = nil
      routeCore = nil
      trafficCores = []
      destinationMark = nil
      return
    }
    if let casing = routeCasing {
      view.removeAnnotation(casing)
      routeCasing = nil
    }
    if let core = routeCore {
      view.removeAnnotation(core)
      routeCore = nil
    }
    for core in trafficCores {
      view.removeAnnotation(core)
    }
    trafficCores = []
    if let mark = destinationMark {
      view.removeAnnotation(mark)
      destinationMark = nil
    }
  }

  // MARK: Traffic-colored segments (phone's TrafficRouteLayer)

  /// Overlays per-range colored cores on top of the blue fallback. An empty
  /// array restores the plain blue line.
  func showTraffic(_ ranges: [RouteTrafficRange]) {
    guard styleLoaded, mapView != nil, !routeCoordinates.isEmpty else {
      pendingTraffic = ranges
      return
    }
    drawTrafficCores(ranges)
  }

  private func drawTrafficCores(_ ranges: [RouteTrafficRange]) {
    guard let view = mapView, !routeCoordinates.isEmpty else { return }
    for core in trafficCores {
      view.removeAnnotation(core)
    }
    trafficCores = []
    for range in ranges {
      let from = max(0, range.from)
      let to = min(routeCoordinates.count - 1, range.to)
      guard to > from else { continue }
      var slice = Array(routeCoordinates[from...to])
      let core = TrafficCorePolyline(coordinates: &slice, count: UInt(slice.count))
      core.color = range.color
      trafficCores.append(core)
      view.addAnnotation(core)
    }
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
    drawPendingRoute()
  }

  func mapView(_ mapView: MLNMapView, strokeColorForShapeAnnotation shape: MLNShape) -> UIColor {
    if let traffic = shape as? TrafficCorePolyline { return traffic.color }
    if shape.title == "route-core" { return Self.routeCoreColor }
    return .white
  }

  func mapView(_ mapView: MLNMapView, lineWidthForPolylineAnnotation polyline: MLNPolyline) -> CGFloat {
    if polyline is TrafficCorePolyline { return 7.5 }
    if polyline.title == "route-core" { return 7.5 }
    return 11
  }

  func mapView(_ mapView: MLNMapView, imageFor annotation: MLNAnnotation) -> MLNAnnotationImage? {
    guard annotation.title == "destination" else { return nil }
    let reuseId = "polaris-destination-flag"
    if let existing = mapView.dequeueReusableAnnotationImage(withIdentifier: reuseId) {
      return existing
    }
    let image = UIImage(systemName: "flag.checkered")?
      .withTintColor(Self.routeCoreColor, renderingMode: .alwaysOriginal)
      ?? UIImage()
    return MLNAnnotationImage(image: image, reuseIdentifier: reuseId)
  }
}

/// Traffic-colored route core. Carries its color because the style delegate
/// only receives the shape, and ranges are simpler than tag bookkeeping.
final class TrafficCorePolyline: MLNPolyline {
  var color: UIColor = .systemBlue
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
      lat += ~(dLat >> 1) ^ -(dLat & 1)
      lng += ~(dLng >> 1) ^ -(dLng & 1)
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
