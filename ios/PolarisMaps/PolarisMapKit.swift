import Foundation
import MapKit

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
    request.resultTypeFilter = .pointOfInterest
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

    // Opening hours (iOS 16+)
    if #available(iOS 16.0, *) {
      if let hours = item.openingHours as? MKOHHours {
        var periods: [[String: String]] = []
        for period in hours.periods {
          var p: [String: String] = [:]
          let cal = Calendar.current
          let openComps = period.open
          if let day = openComps.day, let hour = openComps.hour, let minute = openComps.minute {
            p["openDay"] = "\(day.rawValue)"
            p["openTime"] = String(format: "%02d:%02d", hour, minute)
          }
          if let closeComps = period.close,
             let day = closeComps.day, let hour = closeComps.hour, let minute = closeComps.minute {
            p["closeDay"] = "\(day.rawValue)"
            p["closeTime"] = String(format: "%02d:%02d", hour, minute)
          }
          if !p.isEmpty { periods.append(p) }
        }
        if !periods.isEmpty {
          result["openingHoursPeriods"] = periods
        }
      }
    }

    return result
  }

  /// Required to run on main queue for MKLocalSearch
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
