import ActivityKit
import Foundation

@available(iOS 16.1, *)
@objc(PolarisLiveActivity)
class PolarisLiveActivity: NSObject {
    private var currentActivity: Activity<NavigationAttributes>?
    private var currentDownloadActivity: Activity<DownloadAttributes>?

    @objc static func requiresMainQueueSetup() -> Bool { return true }

    @objc func isSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                           reject: @escaping RCTPromiseRejectBlock) {
        resolve(ActivityAuthorizationInfo().areActivitiesEnabled)
    }

    @objc func startActivity(_ etaSeconds: Double,
                             remainingDistanceMeters: Double,
                             maneuverType: String,
                             maneuverInstruction: String,
                             streetName: String?,
                             destinationName: String,
                             transportMode: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            print("[LiveActivity] Activities not authorized or not supported")
            return
        }

        let attributes = NavigationAttributes(
            destinationName: destinationName,
            transportMode: transportMode
        )

        let contentState = NavigationAttributes.ContentState(
            etaSeconds: Int(etaSeconds),
            remainingDistanceMeters: Int(remainingDistanceMeters),
            maneuverType: maneuverType,
            maneuverInstruction: maneuverInstruction,
            streetName: (streetName?.isEmpty == false) ? streetName : nil
        )

        let initialState = ActivityContent(
            state: contentState,
            staleDate: Date().addingTimeInterval(3600)
        )

        do {
            let activity = try Activity<NavigationAttributes>.request(
                attributes: attributes,
                content: initialState,
                pushType: nil
            )
            currentActivity = activity
            print("[LiveActivity] Started: \(activity.id)")
        } catch {
            print("[LiveActivity] Start error: \(error.localizedDescription)")
        }
    }

    @objc func updateActivity(_ etaSeconds: Double,
                              remainingDistanceMeters: Double,
                              maneuverType: String,
                              maneuverInstruction: String,
                              streetName: String?) {
        guard let activity = currentActivity else { return }

        let contentState = NavigationAttributes.ContentState(
            etaSeconds: Int(etaSeconds),
            remainingDistanceMeters: Int(remainingDistanceMeters),
            maneuverType: maneuverType,
            maneuverInstruction: maneuverInstruction,
            streetName: (streetName?.isEmpty == false) ? streetName : nil
        )

        let content = ActivityContent(
            state: contentState,
            staleDate: Date().addingTimeInterval(3600)
        )

        Task {
            await activity.update(content)
        }
    }

    @objc func endActivity() {
        guard let activity = currentActivity else { return }

        let finalContent = ActivityContent(
            state: activity.content.state,
            staleDate: Date()
        )

        Task {
            await activity.end(finalContent, dismissalPolicy: .immediate)
            currentActivity = nil
        }
    }

    // MARK: - Offline download activity

    private func downloadContentState(percent: Double,
                                      regionCount: Double,
                                      label: String,
                                      stage: String,
                                      isComplete: Bool) -> DownloadAttributes.ContentState {
        DownloadAttributes.ContentState(
            percent: max(0, min(100, Int(percent.rounded()))),
            regionCount: max(0, Int(regionCount)),
            label: label,
            stage: stage,
            isComplete: isComplete
        )
    }

    @objc func startDownloadActivity(_ percent: Double,
                                     regionCount: Double,
                                     label: String,
                                     stage: String,
                                     isComplete: Bool) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            print("[LiveActivity] Activities not authorized or not supported")
            return
        }

        let state = downloadContentState(
            percent: percent,
            regionCount: regionCount,
            label: label,
            stage: stage,
            isComplete: isComplete
        )
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(900))

        if let activity = currentDownloadActivity {
            Task { await activity.update(content) }
            return
        }

        do {
            currentDownloadActivity = try Activity<DownloadAttributes>.request(
                attributes: DownloadAttributes(),
                content: content,
                pushType: nil
            )
            print("[LiveActivity] Download activity started")
        } catch {
            print("[LiveActivity] Download start error: \(error.localizedDescription)")
        }
    }

    @objc func updateDownloadActivity(_ percent: Double,
                                      regionCount: Double,
                                      label: String,
                                      stage: String,
                                      isComplete: Bool) {
        let state = downloadContentState(
            percent: percent,
            regionCount: regionCount,
            label: label,
            stage: stage,
            isComplete: isComplete
        )
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(900))

        if let activity = currentDownloadActivity {
            Task { await activity.update(content) }
            return
        }

        // A prior start may have been rejected during the foreground
        // transition; retry the request here so progress is not silently lost.
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            currentDownloadActivity = try Activity<DownloadAttributes>.request(
                attributes: DownloadAttributes(),
                content: content,
                pushType: nil
            )
            print("[LiveActivity] Download activity started (via update)")
        } catch {
            print("[LiveActivity] Download update/start error: \(error.localizedDescription)")
        }
    }

    @objc func endDownloadActivity(_ immediate: Bool) {
        guard let activity = currentDownloadActivity else { return }

        let finalContent = ActivityContent(state: activity.content.state, staleDate: Date())
        let policy: ActivityUIDismissalPolicy = immediate
            ? .immediate
            : .after(Date().addingTimeInterval(4))

        Task {
            await activity.end(finalContent, dismissalPolicy: policy)
            currentDownloadActivity = nil
        }
    }
}
