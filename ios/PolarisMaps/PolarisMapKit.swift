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
}
