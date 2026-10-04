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
        "osm": {
          "type": "raster",
          "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          "tileSize": 256,
          "attribution": "© OpenStreetMap contributors",
          "maxzoom": 19
        }
      },
      "layers": [
        {
          "id": "background",
          "type": "background",
          "paint": { "background-color": "#E8EAED" }
        },
        {
          "id": "osm-raster",
          "type": "raster",
          "source": "osm",
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
  /// Where the vehicle puck sits vertically during navigation, as a fraction
  /// of the map view height. Low enough to show the road ahead (phone parity),
  /// high enough that the puck and its halo clear CarPlay's floating trip/ETA
  /// bar on both the full-screen map and the shorter dashboard tile. A fixed
  /// metre offset can't do this: the same offset lands lower on tall aspects.
  private static let followScreenFraction: CGFloat = 0.62

  // MARK: Follow glide tuning

  /// Floor for the glide duration: even at foreground push rates (~30 Hz) the
  /// glide spans a few frames instead of restarting every push, which keeps
  /// the motion continuous without perceptible lag behind the fix.
  private static let minGlideSeconds: CFTimeInterval = 0.25
  /// Cap for the glide duration (matches the old elapsed cap).
  private static let maxGlideSeconds: CFTimeInterval = 3.0
  /// A gap longer than this means the push stream resumed after suspension —
  /// snap to the fix instead of gliding across the suspension, and relearn
  /// the cadence. Also the max stale window during coasting.
  private static let snapGapSeconds: CFTimeInterval = 3.0
  /// Exponential-moving-average weight for the inter-push cadence estimate.
  /// A single burst or a single long gap must not skew the next glide.
  private static let pushIntervalEmaAlpha: CFTimeInterval = 0.35
  /// Below this speed the vehicle is considered stationary: no glide needed
  /// and no coasting past the fix.
  private static let coastMinSpeedMps: Double = 0.5
  /// Max time the ticker keeps projecting past the last fix at its speed
  /// (dead-reckoning hold). Bounded so a missed fix can't run the puck down
  /// the road indefinitely; the next fix re-anchors regardless.
  private static let coastMaxSeconds: CFTimeInterval = 2.5
  /// Earth radius for the coast projection (spherical, WGS84 mean).
  private static let earthRadiusMeters: Double = 6_378_137

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
  // Follow smoothing: JS pushes route-snapped fixes at display rate while the
  // phone screen is awake, but only at the raw GPS rate (≈1 Hz) once the
  // display sleeps, even though CarPlay keeps rendering. A run-loop ticker
  // interpolates camera + puck toward each new fix and then keeps projecting
  // past it at the fix's speed, so locked-phone navigation glides instead of
  // jumping once per second.
  //
  // The ticker is a `Timer` on the main run loop, NOT a `CADisplayLink`: a
  // display link follows a display's vsync, and the phone's stops when it
  // locks — precisely when the glide is needed. A run-loop timer has no such
  // dependency, so it keeps driving while the screen is off.
  //
  // Glide durations are FORWARD-looking: an exponential moving average of the
  // inter-push interval (the expected gap to the next fix), floored and
  // capped. Using the last observed gap instead made every jittery fix
  // cadence produce glide–stall–glide stop-motion, and a burst-delivered fix
  // (elapsed ≈ 0) snapped outright. Once the glide reaches the fix the ticker
  // coasts at the fix's speed (bounded) until the next push re-anchors it, so
  // the puck never sits still between fixes while the car is moving.
  private var targetCoordinate: CLLocationCoordinate2D?
  private var targetHeading: Double = 0
  /// Clamped speed (m/s) that the pushed fix was traveling at. Drives the
  /// coast hold: after the glide reaches the fix the ticker keeps projecting
  /// at this speed so the puck doesn't stop dead between ~1 Hz locked-phone
  /// fixes. 0 (unknown/stationary) disables coasting.
  private var targetSpeedMps: Double = 0
  /// Exponential moving average of the inter-push interval — the expected
  /// time until the NEXT push. Glide durations are forward-looking off this
  /// (the last observed gap says nothing about the next one; using it made
  /// every jittery fix cadence read as a per-fix jolt).
  private var pushIntervalEstimate: CFTimeInterval = 0
  private var followTimer: Timer?
  private var animationStart: CFTimeInterval = 0
  private var animationDuration: TimeInterval = 0
  private var animationFromCoordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)
  private var animationFromHeading: Double = 0
  private var lastCameraPushTime: CFTimeInterval = 0
  /// True after a glide completes while the ticker keeps projecting past the
  /// fix at `targetSpeedMps` (see `followAnimationTick`).
  private var coasting = false
  private var coastStart: CFTimeInterval = 0
  // Presentation watchdog: re-asserts the CPWindow content and retries a style
  // that never finished loading (the system can clear the window's root view
  // across template transitions, and a cold-launch style fetch can abort).
  private var watchdogTimer: Timer?
  private var lastAppliedStyleJson: String?
  private var styleReloadSerial = 0
  private var styleRetryCount = 0
  private var styleRequestedAt: CFTimeInterval = 0
  /// Grace period before a style that has neither loaded nor failed is
  /// considered stalled (a slow first load must not be force-reloaded).
  private static let styleRetryGraceSeconds: CFTimeInterval = 8
  private var speedSign: SpeedLimitBadge?
  // Map-plane nav puck (phone parity): the same polygon groups the phone's
  // MapView renders, as MapLibre fill layers so the puck tilts and
  // foreshortens with the 3D follow camera instead of a flat screen-space image.
  private var puckBuilt = false
  private var puckSourceIds: [String] = []
  private var puckLayerIds: [String] = []
  private var pendingStyleJson: String?
  private var lastStyleFileURL: URL?
  /// Set when the style failed to load so the watchdog can retry it even
  /// though `styleLoaded` was re-armed to let route layers rebuild.
  private var styleLoadFailed = false

  /// True once a real position has arrived; guards against locating to (0, 0).
  private(set) var hasCenter = false
  /// True while a navigation session is active; switches to the pitched
  /// heading-up follow camera on every surface (full screen and dashboard
  /// tile) and swaps the idle location dot for the nav puck (matching the
  /// phone, which shows the puck only in navigation mode).
  var isNavigating = false {
    didSet {
      guard oldValue != isNavigating else { return }
      if !isNavigating {
        // Idle doesn't need the follow animation; snap to the last target so
        // the location dot can't drift after guidance ends.
        stopFollowAnimation()
        if let target = targetCoordinate {
          currentCoordinate = target
          lastHeading = targetHeading
        }
      }
      updateVehicleMarkers()
    }
  }

  /// True while the car is moving without an active trip. Uses the same pitched,
  /// heading-up 3D camera and nav puck as navigation (Google/Apple Maps show a
  /// driving map off-route too), falling back to the flat north-up browse view
  /// with the plain location dot when the car is stationary. Derived from the
  /// speed on every GPS push in `updateCenter`.
  private var isDriving = false

  var currentCoordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)

  /// Seeds the position without moving the camera (used for the route start
  /// before the first GPS fix).
  func seedCoordinate(_ coordinate: CLLocationCoordinate2D) {
    currentCoordinate = coordinate
    targetCoordinate = coordinate
    targetHeading = lastHeading
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
    // Full-bleed: the CarPlay surfaces apply safe-area insets (the Dashboard
    // tile is a rounded widget), and MapLibre folds those into `contentInset`
    // and its render surface. We place the camera explicitly, so opt out.
    view.automaticallyAdjustsContentInset = false
    view.contentInset = .zero
    view.insetsLayoutMarginsFromSafeArea = false
    view.logoView.isHidden = true
    view.attributionButton.isHidden = true
    mapView = view

    self.view = view
    window.rootViewController = self
    fillMapRenderSurface()

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

    startWatchdog()
  }

  func deactivate() {
    stopWatchdog()
    stopFollowAnimation()
    clearRoute()
    incidentMarkers = []
    incidentSourceIds = []
    incidentLayerIds = []
    pendingStyleJson = nil
    if let previous = lastStyleFileURL {
      try? FileManager.default.removeItem(at: previous)
    }
    lastStyleFileURL = nil
    lastAppliedStyleJson = nil
    styleReloadSerial = 0
    styleRetryCount = 0
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
    fillMapRenderSurface()
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
  /// template presentation that replaced the window's root view controller,
  /// and retry the style when the launch-time load never finished.
  func refreshPresentation() {
    reassertWindowContent()
    layoutOverlays()
    retryStyleLoadIfNeeded()
  }

  /// Applies a MapLibre style JSON (the phone's resolved style) so the
  /// CarPlay map matches the phone map (dark/light mode, satellite). The
  /// JSON is written to a content-tagged file because MLNMapView only
  /// reloads when the style URL changes. Custom route sources/layers are
  /// rebuilt from `didFinishLoading` after the swap.
  func applyStyle(json: String) {
    applyStyle(json: json, forceReload: false)
  }

  private func applyStyle(json: String, forceReload: Bool) {
    guard !json.isEmpty else { return }
    lastAppliedStyleJson = json
    guard mapView != nil else {
      pendingStyleJson = json
      return
    }
    var hasher = Hasher()
    hasher.combine(json)
    let tag = String(format: "%08x", UInt32(truncatingIfNeeded: hasher.finalize()))
    // A forced retry gets a fresh file name: re-assigning the same style URL
    // that previously failed to load is a no-op in MapLibre.
    let suffix = forceReload ? "-r\(styleReloadSerial)" : ""
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "polaris-carplay-style-\(tag)\(suffix).json")
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
      styleRequestedAt = CACurrentMediaTime()
      mapView?.styleURL = url
    }
  }

  /// Re-applies the last style when it failed outright or stalled (cold launch
  /// style fetches can be aborted while the phone app is suspended). Bounded so
  /// a genuinely broken style isn't reloaded forever.
  private func retryStyleLoadIfNeeded() {
    guard let json = lastAppliedStyleJson, styleRetryCount < 5 else { return }
    let stalled =
      !styleLoaded && CACurrentMediaTime() - styleRequestedAt > Self.styleRetryGraceSeconds
    guard styleLoadFailed || stalled else { return }
    styleRetryCount += 1
    styleReloadSerial += 1
    styleLoadFailed = false
    applyStyle(json: json, forceReload: true)
  }

  private func startWatchdog() {
    stopWatchdog()
    let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
      self?.watchdogTick()
    }
    RunLoop.main.add(timer, forMode: .common)
    watchdogTimer = timer
  }

  private func stopWatchdog() {
    watchdogTimer?.invalidate()
    watchdogTimer = nil
  }

  private func watchdogTick() {
    // The system can clear the CPWindow's content across template
    // transitions; keep re-asserting while attached. Safe to call repeatedly.
    reassertWindowContent()
    retryStyleLoadIfNeeded()
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

  /// Forces the map (and MapLibre's internal render surface) flush with the
  /// CarPlay window.
  ///
  /// The Dashboard window can be resized after the host attaches, and MapLibre
  /// creates its Metal render view with `contentMode = .center` and a
  /// `contentScaleFactor` taken from the *phone's* main screen. On a car
  /// display whose scale differs, that centered, non-stretching content shows
  /// as a uniform bezel inside the map tile: the map view fills the window, but
  /// the rendered map sits inset from its edges. Re-pinning the render surface
  /// and switching it to `.scaleToFill` makes the map reach the tile edges on
  /// both the full-screen map and the Dashboard tile.
  private func fillMapRenderSurface() {
    guard let mapView = mapView else { return }
    if let superview = mapView.superview, mapView.frame != superview.bounds {
      mapView.frame = superview.bounds
    }
    for subview in mapView.subviews
    where NSStringFromClass(type(of: subview)).contains("MTKView") {
      subview.contentMode = .scaleToFill
      if subview.frame != mapView.bounds {
        subview.frame = mapView.bounds
      }
    }
  }

  // MARK: Follow ticker (run-loop timer)

  /// The glide clock: a run-loop timer that is not tied to any display's
  /// vsync, so it keeps driving while the phone screen is locked. Safe to call
  /// repeatedly.
  private func startFollowTimer() {
    guard followTimer == nil else { return }
    let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
      self?.followAnimationTick()
    }
    // Zero tolerance: the coast hold derives the projected position from the
    // tick's own timestamp, so coalesced/deferred fires would show the puck
    // slightly behind where the projection says it is. `.common` keeps the
    // timer firing across template-driven run-loop mode churn.
    timer.tolerance = 0
    RunLoop.main.add(timer, forMode: .common)
    followTimer = timer
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

    // Not navigating or driving: hide the puck and show the plain location dot.
    guard isNavigating || isDriving else {
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

  /// Below this speed (m/s) the idle map stays a flat, north-up browse view with
  /// the location dot. At or above it — with no active trip — the map switches
  /// to the same pitched, heading-up 3D view and nav puck used while
  /// navigating, so simply driving around looks like Google/Apple Maps instead
  /// of a static north-up dot. ~2 m/s ≈ 7 km/h.
  private static let drivingMinSpeedMps: Double = 2.0

  func updateCenter(lat: Double, lng: Double, heading: Double, speedMps: Double) {
    // (0, 0) is the Atlantic off West Africa — never a real fix. Ignoring it
    // keeps the pre-fix default from parking the map in "blank ocean".
    if lat == 0 && lng == 0 { return }
    let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    let now = CACurrentMediaTime()
    let hadTarget = targetCoordinate != nil
    let elapsed = lastCameraPushTime > 0 ? now - lastCameraPushTime : 0
    lastCameraPushTime = now
    targetCoordinate = coordinate
    targetHeading = heading
    targetSpeedMps = max(speedMps, 0)
    hasCenter = true
    // Idle driving (moving, no active trip) mirrors the navigation map:
    // pitched heading-up 3D + nav puck instead of the flat north-up dot.
    // Stays false during a trip so navigation owns the camera/puck state.
    isDriving = !isNavigating && targetSpeedMps > Self.drivingMinSpeedMps

    if hadTarget, elapsed > 0 {
      // Track the push cadence with an EMA so a single burst or a single long
      // gap doesn't skew the next glide's duration.
      pushIntervalEstimate =
        pushIntervalEstimate <= 0
        ? elapsed
        : pushIntervalEstimate + Self.pushIntervalEmaAlpha * (elapsed - pushIntervalEstimate)
    }

    // Snap when there is no continuity to preserve: first fix, follow turned
    // off, neither navigating nor driving, or the push stream resumed after a
    // long suspension (a resumed-from-suspension gap must not glide across
    // minutes of motion).
    let shouldSnap =
      !hadTarget || !followVehicle || !(isNavigating || isDriving)
      || elapsed > Self.snapGapSeconds || mapView == nil
    if elapsed > Self.snapGapSeconds {
      // Cadence knowledge is invalid after a suspension; relearn it.
      pushIntervalEstimate = 0
    }

    animationFromCoordinate = currentCoordinate
    animationFromHeading = lastHeading
    // Forward-looking duration: glide over the expected gap to the next fix
    // (the EMA cadence), not the gap just observed. This keeps the glide
    // running until the re-anchor arrives instead of stalling, and matches
    // the glide speed to the actual inter-fix displacement.
    animationDuration =
      shouldSnap ? 0 : min(max(pushIntervalEstimate, Self.minGlideSeconds), Self.maxGlideSeconds)
    animationStart = now
    coasting = false
    if animationDuration <= 0.001 {
      stopFollowAnimation()
      applyFollowFrame(coordinate: coordinate, heading: heading)
    } else {
      startFollowAnimation()
    }
  }

  /// Applies one rendered follow frame (camera + puck) for the interpolated
  /// position. Called per follow-ticker tick while a push is being smoothed.
  private func applyFollowFrame(coordinate: CLLocationCoordinate2D, heading: Double) {
    currentCoordinate = coordinate
    lastHeading = heading
    // Move the follow camera first so the puck is sized from the camera that's
    // actually in effect. Updating markers before the camera made a recenter
    // redraw the puck at the panned/zoomed-out scale.
    if let view = mapView, followVehicle {
      applyFollowCamera(view, heading: heading)
    }
    updateVehicleMarkers()
  }

  private func startFollowAnimation() {
    guard mapView != nil else { return }
    startFollowTimer()
  }

  private func stopFollowAnimation() {
    followTimer?.invalidate()
    followTimer = nil
    coasting = false
  }

  @objc private func followAnimationTick() {
    guard let target = targetCoordinate else {
      stopFollowAnimation()
      return
    }
    let now = CACurrentMediaTime()
    let progress =
      animationDuration > 0
      ? min(max((now - animationStart) / animationDuration, 0), 1)
      : 1
    let coordinate: CLLocationCoordinate2D
    let heading: Double
    if progress < 1 {
      coordinate = CLLocationCoordinate2D(
        latitude: animationFromCoordinate.latitude
          + (target.latitude - animationFromCoordinate.latitude) * progress,
        longitude: animationFromCoordinate.longitude
          + (target.longitude - animationFromCoordinate.longitude) * progress)
      heading = interpolateHeading(
        from: animationFromHeading, to: targetHeading, progress: progress)
    } else if coasting {
      // Dead-reckoning hold: keep projecting past the last fix at its speed
      // until the next push re-anchors. Without this the puck stops dead at
      // each ~1 Hz locked-phone fix — a per-second stutter around the glide.
      // Bounded so a missed fix can't run the puck down the road forever.
      let coastElapsed = now - coastStart
      if coastElapsed > Self.coastMaxSeconds {
        stopFollowAnimation()
        return
      }
      coordinate = Self.project(
        target, bearing: targetHeading,
        distanceMeters: targetSpeedMps * coastElapsed)
      heading = targetHeading
    } else if (isNavigating || isDriving), followVehicle, targetSpeedMps > Self.coastMinSpeedMps {
      // Glide finished and the vehicle is moving — begin the coast hold.
      coasting = true
      coastStart = now
      coordinate = target
      heading = targetHeading
    } else {
      // Stationary (or follow/navigation off): hold at the fix.
      stopFollowAnimation()
      return
    }
    applyFollowFrame(coordinate: coordinate, heading: heading)
  }

  /// Projects `coordinate` `distanceMeters` along `bearing` (spherical).
  private static func project(
    _ coordinate: CLLocationCoordinate2D, bearing: Double, distanceMeters: Double
  ) -> CLLocationCoordinate2D {
    guard distanceMeters > 0 else { return coordinate }
    let angular = distanceMeters / earthRadiusMeters
    let bearingRad = bearing * .pi / 180
    let lat1 = coordinate.latitude * .pi / 180
    let lng1 = coordinate.longitude * .pi / 180
    let lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearingRad))
    let lng2 =
      lng1
      + atan2(
        sin(bearingRad) * sin(angular) * cos(lat1),
        cos(angular) - sin(lat1) * sin(lat2))
    return CLLocationCoordinate2D(latitude: lat2 * 180 / .pi, longitude: lng2 * 180 / .pi)
  }

  /// Shortest-arc heading interpolation so crossing north doesn't spin the map.
  private func interpolateHeading(from: Double, to: Double, progress: Double) -> Double {
    var delta = (to - from).truncatingRemainder(dividingBy: 360)
    if delta > 180 { delta -= 360 }
    if delta < -180 { delta += 360 }
    return from + delta * progress
  }

  private func applyFollowCamera(_ view: MLNMapView, heading: Double) {
    if isNavigating || isDriving {
      // Heading-up pitched follow camera (phone: zoom 17, pitch 55), shared by
      // the full-screen map and the dashboard split tile so both face the
      // direction of travel like the phone — and by the idle driving view, so
      // simply moving looks the same as guidance. The vehicle is then placed at
      // a fixed fraction of the view height: a fixed metre offset ahead of the
      // target can't guarantee that across the full map and dashboard aspects,
      // which previously parked the puck under the floating ETA bar.
      view.camera = MLNMapCamera(
        lookingAtCenter: currentCoordinate,
        acrossDistance: Self.followDistance,
        pitch: 55,
        heading: heading
      )
      let targetY = view.bounds.height * Self.followScreenFraction
      let vehiclePoint = view.convert(currentCoordinate, toPointTo: view)
      let deltaY = vehiclePoint.y - targetY
      if view.bounds.height > 0, abs(deltaY) > 1 {
        let correctedTarget = view.convert(
          CGPoint(x: view.bounds.midX, y: view.bounds.midY + deltaY),
          toCoordinateFrom: view
        )
        view.camera = MLNMapCamera(
          lookingAtCenter: correctedTarget,
          acrossDistance: Self.followDistance,
          pitch: 55,
          heading: heading
        )
      }
    } else {
      // Idle locate: flat, north-up, centered.
      view.setCenter(currentCoordinate, zoomLevel: Self.idleZoom, direction: 0, animated: false)
    }
  }

  func recenter() {
    followVehicle = true
    routeOverviewActive = false
    stopFollowAnimation()
    if let target = targetCoordinate {
      currentCoordinate = target
      lastHeading = targetHeading
    }
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
    styleLoadFailed = false
    styleRetryCount = 0
    rebuildRouteLayers()
    rebuildIncidentLayers()
  }

  func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
    // Never leave a route parked forever behind a failed style: sources and
    // layers can still be added and will paint if tiles arrive later. The
    // watchdog retries the style itself (a cold-launch fetch can be aborted
    // while the phone app is suspended).
    styleLoadFailed = true
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
