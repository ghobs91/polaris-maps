import ActivityKit
import Foundation

struct DownloadAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var percent: Int
        var regionCount: Int
        var label: String
        var stage: String
        var isComplete: Bool
    }
}
