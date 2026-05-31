import Foundation
import MapKit
import Contacts
import CoreLocation

/// Native module that exposes MKLocalSearch POI data to React Native.
/// Uses MKLocalSearch.Request with resultType = .pointOfInterest to get rich
/// MKMapItem data including phone, URL, and timezone — data the Apple Maps
/// Server API does not provide.
@objc(PolarisMapKit)
class PolarisMapKit: NSObject {

  /// Search for a POI by name near a coordinate and return rich details.
  @objc
  func searchPOI(
    _ query: String,
    latitude: Double,
    longitude: Double,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.pointOfInterestFilter = .includingAll
    request.region = MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      latitudinalMeters: 500,
      longitudinalMeters: 500
    )

    let search = MKLocalSearch(request: request)
    search.start { response, error in
      if let error = error {
        resolve(nil) // Enrichment is best-effort; don't reject
        return
      }

      guard let response = response, !response.mapItems.isEmpty else {
        resolve(nil)
        return
      }

      // Find the closest item within 200m
      let target = CLLocation(latitude: latitude, longitude: longitude)
      var best: MKMapItem?
      var bestDist: CLLocationDistance = .greatestFiniteMagnitude

      for item in response.mapItems {
        let dist = target.distance(from: CLLocation(
          latitude: item.placemark.coordinate.latitude,
          longitude: item.placemark.coordinate.longitude
        ))
        if dist < 200 && dist < bestDist {
          best = item
          bestDist = dist
        }
      }

      guard let match = best else {
        resolve(nil)
        return
      }

      resolve(Self.serializeMapItem(match))
    }
  }

  /// Search for a place by name, optionally scoped to a region hint.
  /// The regionHint is geocoded first (e.g. "Long Island") to bias results.
  /// Returns the top result from MKLocalSearch.
  @objc
  func searchPlace(
    _ query: String,
    regionHint: NSString?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let hint = regionHint as String?
    let geocoder = CLGeocoder()

    let runSearch = { (region: MKCoordinateRegion?) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.pointOfInterestFilter = .includingAll
      if let region = region {
        request.region = region
      }

      let search = MKLocalSearch(request: request)
      search.start { response, error in
        guard let response = response, let first = response.mapItems.first else {
          resolve(nil)
          return
        }
        resolve(Self.serializeMapItem(first))
      }
    }

    // If we have a region hint, geocode it first to bias the search
    if let hint = hint, !hint.isEmpty {
      geocoder.geocodeAddressString(hint) { placemarks, error in
        if let placemark = placemarks?.first, let location = placemark.location {
          // Use the geocoded region, or a 50km radius around the point
          let region: MKCoordinateRegion
          if let circularRegion = placemark.region as? CLCircularRegion {
            region = MKCoordinateRegion(
              center: circularRegion.center,
              latitudinalMeters: circularRegion.radius * 2,
              longitudinalMeters: circularRegion.radius * 2
            )
          } else {
            region = MKCoordinateRegion(
              center: location.coordinate,
              latitudinalMeters: 50_000,
              longitudinalMeters: 50_000
            )
          }
          runSearch(region)
        } else {
          // Geocoding failed — search globally
          runSearch(nil as MKCoordinateRegion?)
        }
      }
    } else {
      runSearch(nil as MKCoordinateRegion?)
    }
  }

  /// Search nearby: returns up to 20 POI results near a coordinate.
  /// Used for augmented place search ("coffeeshop near me").
  @objc
  func searchNearby(
    _ query: String,
    latitude: Double,
    longitude: Double,
    radiusMeters: Double,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.pointOfInterestFilter = .includingAll
    request.region = MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      latitudinalMeters: radiusMeters * 2,
      longitudinalMeters: radiusMeters * 2
    )

    let search = MKLocalSearch(request: request)
    search.start { response, error in
      guard let response = response, !response.mapItems.isEmpty else {
        resolve([])
        return
      }
      let items = Array(response.mapItems.prefix(20))
      resolve(items.map { Self.serializeMapItem($0) })
    }
  }

  /// Search for a place by name and return ALL results (up to 10) for disambiguation.
  @objc
  func searchPlaceAll(
    _ query: String,
    regionHint: NSString?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let hint = regionHint as String?
    let geocoder = CLGeocoder()

    let runSearch = { (region: MKCoordinateRegion?) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.pointOfInterestFilter = .includingAll
      if let region = region {
        request.region = region
      }

      let search = MKLocalSearch(request: request)
      search.start { response, error in
        guard let response = response, !response.mapItems.isEmpty else {
          resolve([])
          return
        }
        let items = Array(response.mapItems.prefix(10))
        resolve(items.map { Self.serializeMapItem($0) })
      }
    }

    if let hint = hint, !hint.isEmpty {
      geocoder.geocodeAddressString(hint) { placemarks, error in
        if let placemark = placemarks?.first, let location = placemark.location {
          let region: MKCoordinateRegion
          if let circularRegion = placemark.region as? CLCircularRegion {
            region = MKCoordinateRegion(
              center: circularRegion.center,
              latitudinalMeters: circularRegion.radius * 2,
              longitudinalMeters: circularRegion.radius * 2
            )
          } else {
            region = MKCoordinateRegion(
              center: location.coordinate,
              latitudinalMeters: 50_000,
              longitudinalMeters: 50_000
            )
          }
          runSearch(region)
        } else {
          runSearch(nil as MKCoordinateRegion?)
        }
      }
    } else {
      runSearch(nil as MKCoordinateRegion?)
    }
  }

  /// Convert an MKMapItem into a JSON-safe dictionary.
  private static func serializeMapItem(_ item: MKMapItem) -> [String: Any?] {
    var result: [String: Any?] = [
      "name": item.name,
      "phoneNumber": item.phoneNumber,
      "url": item.url?.absoluteString,
      "latitude": item.placemark.coordinate.latitude,
      "longitude": item.placemark.coordinate.longitude,
      "pointOfInterestCategory": item.pointOfInterestCategory?.rawValue,
    ]

    // Address components from CLPlacemark
    let pm = item.placemark
    result["thoroughfare"] = pm.thoroughfare
    result["subThoroughfare"] = pm.subThoroughfare
    result["locality"] = pm.locality
    result["subLocality"] = pm.subLocality
    result["administrativeArea"] = pm.administrativeArea
    result["subAdministrativeArea"] = pm.subAdministrativeArea
    result["postalCode"] = pm.postalCode
    result["country"] = pm.country
    result["isoCountryCode"] = pm.isoCountryCode
    result["timeZone"] = pm.timeZone?.identifier

    // Formatted address lines
    if let lines = pm.postalAddress {
      let formatter = CNPostalAddressFormatter()
      result["formattedAddress"] = formatter.string(from: lines)
    }

    return result
  }

  /// Required to run on main queue for MKLocalSearch
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  // MARK: - Routing via MKDirections

  /// Compute a route using Apple's MapKit MKDirections API.
  /// Serves as a third-tier fallback when Valhalla (native + online) is unavailable.
  @objc
  func computeRoute(
    _ waypoints: NSArray,
    costing: NSString,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let wps = waypoints as? [[String: Any]], wps.count >= 2 else {
      reject("MAPKIT_INVALID_INPUT", "At least 2 waypoints are required.", nil)
      return
    }

    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
      latitude: (wps.first!["lat"] as? Double) ?? 0,
      longitude: (wps.first!["lng"] as? Double) ?? 0
    )))
    request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
      latitude: (wps.last!["lat"] as? Double) ?? 0,
      longitude: (wps.last!["lng"] as? Double) ?? 0
    )))
    request.transportType = Self.transportType(for: costing as String)
    request.requestsAlternateRoutes = false

    let directions = MKDirections(request: request)
    directions.calculate { response, error in
      if let error = error {
        reject("MAPKIT_ROUTE_ERROR", error.localizedDescription, error)
        return
      }
      guard let route = response?.routes.first else {
        reject("MAPKIT_NO_ROUTE", "MapKit could not find a route.", nil)
        return
      }
      resolve([Self.serializeRoute(route)])
    }
  }

  /// Reroute using Apple's MapKit MKDirections API.
  @objc
  func reroute(
    _ currentPosition: NSDictionary,
    destination: NSDictionary,
    costing: NSString,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let fromLat = (currentPosition["lat"] as? NSNumber)?.doubleValue ?? 0
    let fromLng = (currentPosition["lng"] as? NSNumber)?.doubleValue ?? 0
    let toLat = (destination["lat"] as? NSNumber)?.doubleValue ?? 0
    let toLng = (destination["lng"] as? NSNumber)?.doubleValue ?? 0

    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(
      coordinate: CLLocationCoordinate2D(latitude: fromLat, longitude: fromLng)
    ))
    request.destination = MKMapItem(placemark: MKPlacemark(
      coordinate: CLLocationCoordinate2D(latitude: toLat, longitude: toLng)
    ))
    request.transportType = Self.transportType(for: costing as String)
    request.requestsAlternateRoutes = false

    let directions = MKDirections(request: request)
    directions.calculate { response, error in
      if let error = error {
        reject("MAPKIT_REROUTE_ERROR", error.localizedDescription, error)
        return
      }
      guard let route = response?.routes.first else {
        reject("MAPKIT_NO_ROUTE", "MapKit could not find a route.", nil)
        return
      }
      resolve(Self.serializeRoute(route))
    }
  }

  // MARK: - Route Serialization

  private static func serializeRoute(_ route: MKRoute) -> [String: Any] {
    let steps = route.steps
    let coordinates = route.polyline.coordinates
    let geometry = encodePolyline(coordinates: coordinates, precision: 1e6)

    var minLat = 90.0, maxLat = -90.0, minLon = 180.0, maxLon = -180.0
    for coord in coordinates {
      minLat = min(minLat, coord.latitude)
      maxLat = max(maxLat, coord.latitude)
      minLon = min(minLon, coord.longitude)
      maxLon = max(maxLon, coord.longitude)
    }

    var shapeIndex = 0
    let maneuvers: [[String: Any]] = steps.enumerated().map { index, step in
      let stepPointCount = step.polyline.pointCount
      let beginIdx = shapeIndex
      let endIdx = shapeIndex + max(stepPointCount - 1, 0)
      shapeIndex = endIdx

      let maneuverType: String
      if index == 0 {
        maneuverType = "start"
      } else if index == steps.count - 1 {
        maneuverType = "destination"
      } else {
        maneuverType = inferManeuverType(from: step)
      }

      return [
        "type": maneuverType,
        "instruction": step.instructions,
        "distance_meters": step.distance,
        "duration_seconds": step.expectedTravelTime,
        "begin_shape_index": beginIdx,
        "end_shape_index": endIdx,
        "verbal_pre_transition": step.instructions,
      ] as [String: Any]
    }

    let leg: [String: Any] = [
      "maneuvers": maneuvers,
      "distance_meters": route.distance,
      "duration_seconds": route.expectedTravelTime,
    ]

    return [
      "summary": [
        "distance_meters": route.distance,
        "duration_seconds": route.expectedTravelTime,
        "has_toll": false,
        "has_ferry": route.transportType == .automobile && route.name.lowercased().contains("ferry"),
      ] as [String: Any],
      "legs": [leg],
      "geometry": geometry,
      "bounding_box": [minLon, minLat, maxLon, maxLat],
    ]
  }

  // MARK: - Polyline Encoding (precision 6 for Valhalla compatibility)

  private static func encodePolyline(coordinates: [CLLocationCoordinate2D], precision: Double) -> String {
    var encoded = ""
    var prevLat = 0
    var prevLng = 0
    for coord in coordinates {
      let lat = Int((coord.latitude * precision).rounded())
      let lng = Int((coord.longitude * precision).rounded())
      encoded += encodeValue(lat - prevLat)
      encoded += encodeValue(lng - prevLng)
      prevLat = lat
      prevLng = lng
    }
    return encoded
  }

  private static func encodeValue(_ value: Int) -> String {
    var v = value < 0 ? ~(value << 1) : (value << 1)
    var encoded = ""
    while v >= 0x20 {
      encoded += String(UnicodeScalar((v & 0x1F) | 0x20 + 63)!)
      v >>= 5
    }
    encoded += String(UnicodeScalar(v + 63)!)
    return encoded
  }

  // MARK: - Routing Helpers

  private static func transportType(for costing: String) -> MKDirectionsTransportType {
    switch costing {
    case "auto", "transit": return .automobile
    case "pedestrian": return .walking
    case "bicycle": return .automobile
    default: return .automobile
    }
  }

  private static func inferManeuverType(from step: MKRouteStep) -> String {
    let instr = step.instructions.lowercased()
    if instr.contains("roundabout") || instr.contains("traffic circle") {
      return instr.contains("exit") || instr.contains("leave") ? "exit_roundabout" : "enter_roundabout"
    }
    if instr.contains("highway") || instr.contains("freeway") || instr.contains("motorway") || instr.contains("interstate") {
      return instr.contains("exit") || instr.contains("off") ? "exit_highway" : "enter_highway"
    }
    if instr.contains("u-turn") || instr.contains("uturn") { return "u_turn" }
    if instr.contains("ferry") { return "ferry" }
    if instr.contains("merge") { return instr.contains("left") ? "merge_left" : "merge_right" }
    if instr.contains("sharp right") { return "sharp_right" }
    if instr.contains("sharp left") { return "sharp_left" }
    if instr.contains("slight right") || instr.contains("bear right") || instr.contains("keep right") { return "slight_right" }
    if instr.contains("slight left") || instr.contains("bear left") || instr.contains("keep left") { return "slight_left" }
    if instr.contains("right") { return "turn_right" }
    if instr.contains("left") { return "turn_left" }
    if instr.contains("continue onto") || instr.contains("continue on") { return "name_change" }
    return "continue"
  }
}
