import Foundation
import Valhalla
import ValhallaModels
import ValhallaConfigModels

/// React Native NativeModule wrapping the valhalla-mobile library for on-device routing.
///
/// This module provides the primary offline routing path for Polaris Maps.
/// When local tiles are available, routing is computed entirely on-device
/// using Valhalla's C++ engine via the valhalla-mobile library.
/// When the native module is not available or fails, the JS layer falls
/// back to the public OSM Valhalla HTTP API at valhalla1.openstreetmap.de.
@objc(PolarisValhalla)
class PolarisValhalla: NSObject {
    private var valhallaInstance: Valhalla?
    private var isInitialized = false

    /// Serial queue for thread-safe access to the Valhalla instance.
    private let serialQueue = DispatchQueue(label: "com.polarismaps.valhalla")

    // MARK: - React Native Bridge

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    // MARK: - initialize

    @objc func initialize(_ config: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        serialQueue.async { [weak self] in
            guard let self = self else { return }

            do {
                let graphTilePath = config["graphTilePath"] as? String ?? ""

                // Determine if the path is a tar file or extracted directory
                var valhallaConfig: ValhallaConfigModels.ValhallaConfig
                if graphTilePath.hasSuffix(".tar") {
                    valhallaConfig = try ValhallaConfigModels.ValhallaConfig(tileExtractTar: URL(fileURLWithPath: graphTilePath))
                } else {
                    valhallaConfig = try ValhallaConfigModels.ValhallaConfig(tilesDir: URL(fileURLWithPath: graphTilePath))
                }

                // Dispose previous instance if re-initializing
                self.valhallaInstance = nil

                self.valhallaInstance = try Valhalla(valhallaConfig)
                self.isInitialized = true
                resolve(nil)
            } catch let error {
                self.isInitialized = false
                reject("VALHALLA_INIT_ERROR", "Failed to initialize Valhalla: \(error.localizedDescription)", error)
            }
        }
    }

    // MARK: - computeRoute

    @objc func computeRoute(_ waypoints: NSArray, costing: NSString, options: NSDictionary?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        serialQueue.async { [weak self] in
            guard let self = self, self.isInitialized, let valhalla = self.valhallaInstance else {
                reject("VALHALLA_NOT_INITIALIZED", "Valhalla routing engine is not initialized. Call initialize() first.", nil)
                return
            }

            do {
                let request = self.buildRouteRequest(waypoints: waypoints, costing: costing as String, options: options)
                let response = try valhalla.route(request: request)
                let mapped = self.mapRouteResponseToNative(response, waypoints: waypoints)
                resolve(mapped)
            } catch let error {
                reject("VALHALLA_ROUTE_ERROR", "Route computation failed: \(error.localizedDescription)", error)
            }
        }
    }

    // MARK: - reroute

    @objc func reroute(_ currentPosition: NSDictionary, destination: NSDictionary, costing: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        serialQueue.async { [weak self] in
            guard let self = self, self.isInitialized, let valhalla = self.valhallaInstance else {
                reject("VALHALLA_NOT_INITIALIZED", "Valhalla routing engine is not initialized.", nil)
                return
            }

            do {
                let fromLat = (currentPosition["lat"] as? NSNumber)?.doubleValue ?? 0
                let fromLng = (currentPosition["lng"] as? NSNumber)?.doubleValue ?? 0
                let toLat = (destination["lat"] as? NSNumber)?.doubleValue ?? 0
                let toLng = (destination["lng"] as? NSNumber)?.doubleValue ?? 0

                let request = RouteRequest(
                    locations: [
                        RoutingWaypoint(lat: fromLat, lon: fromLng),
                        RoutingWaypoint(lat: toLat, lon: toLng),
                    ],
                    costing: self.mapCostingModel(costing as String),
                    units: .km,
                    directionsType: .instructions,
                    format: .json
                )

                let response = try valhalla.route(request: request)
                let mapped = self.mapSingleRouteToNative(response)
                resolve(mapped)
            } catch let error {
                reject("VALHALLA_REROUTE_ERROR", "Reroute failed: \(error.localizedDescription)", error)
            }
        }
    }

    // MARK: - updateTrafficSpeeds

    /// valhalla-mobile does not currently support live traffic speed updates.
    /// This is a no-op that returns success; the JS layer handles traffic via TomTom API.
    @objc func updateTrafficSpeeds(_ speeds: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // Not supported by valhalla-mobile — traffic is handled by the JS layer
        resolve(nil)
    }

    // MARK: - hasCoverage

    /// valhalla-mobile does not expose tile coverage checking.
    /// Returns true if initialized (tiles loaded), false otherwise.
    @objc func hasCoverage(_ bounds: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        resolve(isInitialized)
    }

    // MARK: - getLoadedRegions

    @objc func getLoadedRegions(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // valhalla-mobile doesn't expose region tracking.
        // Return empty array; the JS layer tracks regions independently.
        resolve([])
    }

    // MARK: - dispose

    @objc func dispose(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        serialQueue.async { [weak self] in
            self?.valhallaInstance = nil
            self?.isInitialized = false
            resolve(nil)
        }
    }

    // MARK: - Private Helpers

    private func buildRouteRequest(waypoints: NSArray, costing: String, options: NSDictionary?) -> RouteRequest {
        let locations = waypoints.compactMap { wp -> RoutingWaypoint? in
            guard let dict = wp as? NSDictionary else { return nil }
            let lat = (dict["lat"] as? NSNumber)?.doubleValue ?? 0
            let lng = (dict["lng"] as? NSNumber)?.doubleValue ?? 0
            return RoutingWaypoint(lat: lat, lon: lng)
        }

        let avoidTolls = (options?["avoidTolls"] as? Bool) ?? false
        let avoidHighways = (options?["avoidHighways"] as? Bool) ?? false
        let avoidFerries = (options?["avoidFerries"] as? Bool) ?? false
        let alternates = (options?["alternates"] as? NSNumber)?.intValue ?? 0

        let costingOptions: CostingOptions? = {
            switch costing {
            case "auto":
                return CostingOptions(
                    auto: AutoCostingOptions(
                        useFerry: avoidFerries ? 0 : 1,
                        useHighways: avoidHighways ? 0 : 1,
                        useTolls: avoidTolls ? 0 : 1
                    )
                )
            default:
                return nil
            }
        }()

        return RouteRequest(
            locations: locations,
            costing: mapCostingModel(costing),
            costingOptions: costingOptions,
            units: .km,
            directionsType: .instructions,
            format: .json,
            alternates: alternates
        )
    }

    private func mapCostingModel(_ costing: String) -> CostingModel {
        switch costing {
        case "auto": return .auto
        case "pedestrian": return .pedestrian
        case "bicycle": return .bicycle
        case "transit": return .auto // valhalla-mobile doesn't support transit costing, fallback to auto
        default: return .auto
        }
    }

    private func mapRouteResponseToNative(_ response: RouteResponse, waypoints: NSArray) -> [[String: Any]] {
        // Valhalla can return alternates, but valhalla-mobile currently returns a single trip.
        // We wrap it in an array for consistency with the multi-route API.
        return [mapSingleRouteToNative(response)]
    }

    private func mapSingleRouteToNative(_ response: RouteResponse) -> [String: Any] {
        let trip = response.trip
        let summary = trip.summary

        // Each leg carries its own shape with shape indices relative to that
        // leg. Stitch them into one geometry (dropping duplicated via-point
        // joints) and offset maneuver indices into the combined shape —
        // otherwise multi-stop routes only track/render the first leg.
        let legShapes = trip.legs.map { $0.shape }
        let legPointArrays = legShapes.map { decodePolyline6($0) }
        var shapeOffsets: [Int] = []
        var acc = 0
        for pts in legPointArrays {
            shapeOffsets.append(acc)
            if !pts.isEmpty { acc += pts.count - 1 }
        }
        var combinedPoints: [(Double, Double)] = []
        for pts in legPointArrays {
            guard !pts.isEmpty else { continue }
            combinedPoints.append(contentsOf: pts.dropFirst(combinedPoints.isEmpty ? 0 : 1))
        }
        let multiLeg = trip.legs.count > 1

        let legs: [[String: Any]] = trip.legs.enumerated().map { (legIdx, leg) in
            let offset = multiLeg ? (shapeOffsets[legIdx]) : 0
            let maneuvers: [[String: Any]] = leg.maneuvers.map { m in
                [
                    "type": mapManeuverType(m.type),
                    "instruction": m.instruction,
                    "distance_meters": m.length * 1000,
                    "duration_seconds": m.time,
                    "begin_shape_index": m.beginShapeIndex + offset,
                    "end_shape_index": m.endShapeIndex + offset,
                    "street_names": m.streetNames ?? [],
                    "verbal_pre_transition": m.verbalPreTransitionInstruction ?? "",
                    "verbal_post_transition": m.verbalPostTransitionInstruction as Any,
                ] as [String: Any]
            }

            let legSummary = leg.summary
            return [
                "maneuvers": maneuvers,
                "distance_meters": legSummary.length * 1000,
                "duration_seconds": legSummary.time,
            ]
        }

        let shape: String = {
            if !multiLeg { return legShapes.first ?? "" }
            guard !combinedPoints.isEmpty else { return legShapes.first ?? "" }
            return encodePolyline6(combinedPoints)
        }()

        // RouteSummary no longer exposes hasToll/hasFerry, so derive them from maneuvers.
        var hasToll = false
        var hasFerry = false
        for leg in trip.legs {
            for m in leg.maneuvers {
                if m.toll == true { hasToll = true }
                if m.ferry == true { hasFerry = true }
            }
        }

        return [
            "summary": [
                "distance_meters": summary.length * 1000,
                "duration_seconds": summary.time,
                "has_toll": hasToll,
                "has_ferry": hasFerry,
            ] as [String: Any],
            "legs": legs,
            "geometry": shape,
            "bounding_box": [
                summary.minLon,
                summary.minLat,
                summary.maxLon,
                summary.maxLat,
            ],
        ]
    }

        /// Maps Valhalla integer maneuver type codes to ManeuverType strings
    /// matching the `ManeuverType` union in src/models/route.ts.

    // MARK: - Polyline helpers (precision 6, matching Valhalla shape encoding)

    /// Decode a precision-6 encoded polyline into (lon, lat) pairs.
    private func decodePolyline6(_ encoded: String) -> [(Double, Double)] {
        var coords: [(Double, Double)] = []
        var index = encoded.unicodeScalars.startIndex
        let end = encoded.unicodeScalars.endIndex
        var lat = 0
        var lng = 0
        let factor = 1_000_000.0
        func nextDelta() -> Int? {
            var shift = 0
            var result = 0
            while index < end {
                let byte = Int(encoded.unicodeScalars[index].value) - 63
                index = encoded.unicodeScalars.index(after: index)
                result |= (byte & 0x1f) << shift
                shift += 5
                if byte < 0x20 {
                    return (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
                }
            }
            return nil
        }
        while true {
            guard let dLat = nextDelta(), let dLng = nextDelta() else { break }
            lat += dLat
            lng += dLng
            coords.append((Double(lng) / factor, Double(lat) / factor))
        }
        return coords
    }

    /// Encode (lon, lat) pairs into a precision-6 encoded polyline.
    private func encodePolyline6(_ coords: [(Double, Double)]) -> String {
        let factor = 1_000_000.0
        var prevLat = 0
        var prevLng = 0
        var out = ""
        func enc(_ v: Int) {
            var val = v < 0 ? ~(v << 1) : (v << 1)
            while val >= 0x20 {
                out.append(Character(UnicodeScalar((0x20 | (val & 0x1f)) + 63)!))
                val >>= 5
            }
            out.append(Character(UnicodeScalar(val + 63)!))
        }
        for (lon, lat) in coords {
            let latE = Int((lat * factor).rounded())
            let lngE = Int((lon * factor).rounded())
            enc(latE - prevLat)
            enc(lngE - prevLng)
            prevLat = latE
            prevLng = lngE
        }
        return out
    }    private func mapManeuverType(_ code: Int) -> String {
        switch code {
        case 1, 2, 3: return "start"
        case 4, 5, 6: return "destination"
        case 7: return "name_change"
        case 8: return "continue"
        case 9: return "slight_right"
        case 10: return "turn_right"
        case 11: return "sharp_right"
        case 12, 13: return "u_turn"
        case 14: return "sharp_left"
        case 15: return "turn_left"
        case 16: return "slight_left"
        case 17, 22: return "continue"
        case 18, 19: return "enter_highway"
        case 20, 21: return "exit_highway"
        case 23: return "merge_right"
        case 24, 25: return "merge_left"
        case 26: return "enter_roundabout"
        case 27: return "exit_roundabout"
        case 28: return "ferry"
        default: return "continue"
        }
    }
}
