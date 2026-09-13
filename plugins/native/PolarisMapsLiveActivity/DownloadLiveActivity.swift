import WidgetKit
import SwiftUI
import ActivityKit

@available(iOS 16.1, *)
struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadAttributes.self) { context in
            DownloadLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: downloadIcon(isComplete: context.state.isComplete))
                            .font(.title2)
                            .foregroundColor(downloadTint(isComplete: context.state.isComplete))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(context.state.label)
                                .font(.caption)
                                .fontWeight(.semibold)
                                .lineLimit(1)
                            Text(context.state.stage)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.percent)%")
                        .font(.title3)
                        .fontWeight(.bold)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(value: Double(context.state.percent), total: 100)
                        .tint(downloadTint(isComplete: context.state.isComplete))
                }
            } compactLeading: {
                Image(systemName: downloadIcon(isComplete: context.state.isComplete))
                    .font(.caption)
                    .foregroundColor(downloadTint(isComplete: context.state.isComplete))
            } compactTrailing: {
                Text("\(context.state.percent)%")
                    .font(.caption2)
                    .fontWeight(.semibold)
            } minimal: {
                Image(systemName: downloadIcon(isComplete: context.state.isComplete))
                    .foregroundColor(downloadTint(isComplete: context.state.isComplete))
            }
        }
    }
}

@available(iOS 16.1, *)
struct DownloadLockScreenView: View {
    let context: ActivityViewContext<DownloadAttributes>

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: downloadIcon(isComplete: context.state.isComplete))
                    .font(.title)
                    .foregroundColor(downloadTint(isComplete: context.state.isComplete))
                    .frame(width: 36)

                VStack(alignment: .leading, spacing: 3) {
                    Text(context.state.label)
                        .font(.headline)
                        .lineLimit(1)
                    Text(context.state.stage)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Text("\(context.state.percent)%")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(downloadTint(isComplete: context.state.isComplete))
            }

            ProgressView(value: Double(context.state.percent), total: 100)
                .tint(downloadTint(isComplete: context.state.isComplete))
        }
        .padding()
    }
}

func downloadIcon(isComplete: Bool) -> String {
    isComplete ? "checkmark.circle.fill" : "arrow.down.circle.fill"
}

func downloadTint(isComplete: Bool) -> Color {
    isComplete ? .green : .blue
}
