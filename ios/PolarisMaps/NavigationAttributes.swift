import ActivityKit
import Foundation

struct NavigationAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var etaSeconds: Int
        var remainingDistanceMeters: Int
        var maneuverType: String
        var maneuverInstruction: String
        var streetName: String?
    }

    var destinationName: String
    var transportMode: String
}
