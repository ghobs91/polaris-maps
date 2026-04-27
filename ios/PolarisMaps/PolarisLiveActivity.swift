import ActivityKit
import Foundation

@available(iOS 16.1, *)
@objc(PolarisLiveActivity)
class PolarisLiveActivity: NSObject {
    private var currentActivity: Activity<NavigationAttributes>?

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
}

@available(iOS 16.1, *)
extension PolarisLiveActivity {
    /// Ensures that @objc method signatures are bridged with the correct arg counts.
    @objc func startActivity_etaSeconds_remainingDistanceMeters_maneuverType_maneuverInstruction_streetName_destinationName_transportMode(
        _ etaSeconds: Double,
        _ remainingDistanceMeters: Double,
        _ maneuverType: String,
        _ maneuverInstruction: String,
        _ streetName: String?,
        _ destinationName: String,
        _ transportMode: String
    ) {
        startActivity(etaSeconds,
                      remainingDistanceMeters: remainingDistanceMeters,
                      maneuverType: maneuverType,
                      maneuverInstruction: maneuverInstruction,
                      streetName: streetName,
                      destinationName: destinationName,
                      transportMode: transportMode)
    }

    @objc func updateActivity_etaSeconds_remainingDistanceMeters_maneuverType_maneuverInstruction_streetName(
        _ etaSeconds: Double,
        _ remainingDistanceMeters: Double,
        _ maneuverType: String,
        _ maneuverInstruction: String,
        _ streetName: String?
    ) {
        updateActivity(etaSeconds,
                       remainingDistanceMeters: remainingDistanceMeters,
                       maneuverType: maneuverType,
                       maneuverInstruction: maneuverInstruction,
                       streetName: streetName)
    }
}
