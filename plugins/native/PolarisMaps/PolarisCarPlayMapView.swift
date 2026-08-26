import Foundation
import CarPlay
import MapLibre
import MapKit
import UIKit

/// Hosts a live MapLibre map inside the CarPlay window and draws the active
/// route. Created lazily on scene connect and torn down on disconnect so the
/// second render target only costs resources while CarPlay is attached.
final class CarPlayMapViewHost: UIViewController, MLNMapViewDelegate {

  /// Same default style as the phone-side light map (src/constants/config.ts).
  private static let styleURL = URL(string: "https://tiles.openfreemap.org/styles/liberty")!

  private var mapView: MLNMapView?
  private var routePolyline: MLNPolyline?
  private weak var carPlayWindow: CPWindow?
  private var followVehicle = true

  var currentCoordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)

  func activate(in window: CPWindow) {
    guard mapView == nil else { return }
    carPlayWindow = window

    let view = MLNMapView(frame: UIScreen.main.bounds)
    view.styleURL = Self.styleURL
    view.delegate = self
    view.showsUserLocation = false
    view.logoView.isHidden = true
    view.attributionButton.isHidden = true
    mapView = view

    self.view = view
    window.rootViewController = self
  }

  func deactivate() {
    clearRoute()
    mapView?.delegate = nil
    mapView = nil
    view = nil
    carPlayWindow?.rootViewController = nil
    carPlayWindow = nil
  }

  // MARK: Route

  func showRoute(encodedPolyline: String) {
    guard let view = mapView else { return }
    clearRoute()

    let coordinates = PolylineDecoder.decode(encodedPolyline)
    guard coordinates.count >= 2 else { return }

    let polyline = MLNPolyline(coordinates: coordinates, count: UInt(coordinates.count))
    routePolyline = polyline
    view.addAnnotation(polyline)

    if followVehicle {
      fitCamera(to: coordinates)
    }
  }

  func clearRoute() {
    guard let view = mapView else { return }
    if let polyline = routePolyline {
      view.removeAnnotation(polyline)
      routePolyline = nil
    }
  }

  // MARK: Camera

  func updateCenter(lat: Double, lng: Double, heading: Double) {
    currentCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
    guard let view = mapView, followVehicle else { return }
    view.setCenter(currentCoordinate, zoomLevel: max(view.zoomLevel, 14), animated: true)
    view.direction = heading.truncatingRemainder(dividingBy: 360)
  }

  func recenter() {
    followVehicle = true
    guard let view = mapView else { return }
    view.setCenter(currentCoordinate, animated: true)
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

  // MARK: MLNMapViewDelegate

  func mapView(_ mapView: MLNMapView, strokeColorForShapeAnnotation shape: MLNShape) -> UIColor {
    UIColor.systemBlue
  }

  func mapView(_ mapView: MLNMapView, lineWidthForPolylineAnnotation polyline: MLNPolyline) -> CGFloat {
    6
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
