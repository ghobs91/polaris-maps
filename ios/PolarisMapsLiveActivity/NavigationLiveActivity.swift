import WidgetKit
import SwiftUI
import ActivityKit

struct NavigationLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NavigationAttributes.self) { context in
            // Lock Screen / banner UI
            LockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded leading: direction + remainder in current step
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 4) {
                        Image(systemName: maneuverIcon(for: context.state.maneuverType))
                            .font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(context.state.maneuverInstruction)
                                .font(.caption)
                                .fontWeight(.semibold)
                                .lineLimit(1)
                            if let street = context.state.streetName {
                                Text(street)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .padding(.leading, 4)
                }
                // Expanded trailing: ETA + distance
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatDuration(context.state.etaSeconds))
                            .font(.caption)
                            .fontWeight(.bold)
                        Text(formatDistance(context.state.remainingDistanceMeters))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.trailing, 4)
                }
                // Expanded center: arrival time
                DynamicIslandExpandedRegion(.center) {
                    Text(arrivalTime(etaSeconds: context.state.etaSeconds))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                // Expanded bottom: destination + transport mode
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 4) {
                        Image(systemName: transportModeIcon(for: context.attributes.transportMode))
                            .font(.caption2)
                        Text(context.attributes.destinationName)
                            .font(.caption2)
                            .lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: maneuverIcon(for: context.state.maneuverType))
                    .font(.caption)
            } compactTrailing: {
                Text(formatDurationCompact(context.state.etaSeconds))
                    .font(.caption2)
                    .fontWeight(.semibold)
            } minimal: {
                Image(systemName: maneuverIcon(for: context.state.maneuverType))
            }
        }
    }
}

/// Lock Screen full view
struct LockScreenView: View {
    let context: ActivityViewContext<NavigationAttributes>

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: maneuverIcon(for: context.state.maneuverType))
                .font(.title)
                .foregroundColor(.green)
                .frame(width: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(context.state.maneuverInstruction)
                    .font(.headline)
                    .lineLimit(2)
                if let street = context.state.streetName {
                    Text(street)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(formatDuration(context.state.etaSeconds))
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.green)
                Text(formatDistance(context.state.remainingDistanceMeters))
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text("ETA \(arrivalTime(etaSeconds: context.state.etaSeconds))")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
    }
}

// MARK: - Helpers

func maneuverIcon(for type: String) -> String {
    switch type {
    case "turn_left": return "arrow.turn.up.left"
    case "turn_right": return "arrow.turn.up.right"
    case "sharp_left": return "arrow.turn.backward.left"
    case "sharp_right": return "arrow.turn.backward.right"
    case "slight_left": return "arrow.up.left"
    case "slight_right": return "arrow.up.right"
    case "continue": return "arrow.up"
    case "u_turn": return "arrow.uturn.up"
    case "merge_left": return "arrow.merge.left"
    case "merge_right": return "arrow.merge.right"
    case "enter_roundabout", "exit_roundabout": return "arrow.triangle.turn.up.right.circle"
    case "enter_highway", "exit_highway": return "arrow.up.forward"
    case "ferry": return "ferry"
    case "destination": return "flag"
    default: return "arrow.up"
    }
}

func transportModeIcon(for mode: String) -> String {
    switch mode {
    case "auto": return "car"
    case "pedestrian": return "figure.walk"
    case "bicycle": return "bicycle"
    case "transit": return "tram"
    default: return "car"
    }
}

func formatDuration(_ seconds: Int) -> String {
    let hrs = seconds / 3600
    let mins = (seconds % 3600) / 60
    if hrs > 0 { return "\(hrs)h \(mins)m" }
    return "\(max(1, mins)) min"
}

func formatDurationCompact(_ seconds: Int) -> String {
    let mins = (seconds % 3600) / 60
    let hrs = seconds / 3600
    if hrs > 0 { return "\(hrs)h \(mins)m" }
    return "\(max(1, mins))m"
}

func formatDistance(_ meters: Int) -> String {
    if meters >= 1609 {
        let miles = Double(meters) / 1609.34
        return String(format: "%.1f mi", miles)
    }
    let feet = Double(meters) * 3.28084
    return String(format: "%.0f ft", feet)
}

func arrivalTime(etaSeconds: Int) -> String {
    let arrival = Date().addingTimeInterval(TimeInterval(etaSeconds))
    let formatter = DateFormatter()
    formatter.dateFormat = "h:mm a"
    return formatter.string(from: arrival)
}
