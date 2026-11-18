import Foundation
import SwiftUI

/// Dashboard state: one poll loop, one command path.
///
/// Everything shown is what the daemon last reported; nothing is optimistically
/// applied, so a failed or slow command can never leave the window claiming a
/// state the relay is not in. `lastOutcome` exists to say what happened, including
/// "that did not work".
@MainActor
final class RelayStore: ObservableObject {
    /// One store for the menu bar and the window, so opening the dashboard never
    /// starts a second poll loop or shows a different snapshot.
    static let shared = RelayStore()

    @Published private(set) var status: RelayStatus?
    @Published private(set) var lastError: String?
    @Published private(set) var busy = false
    @Published private(set) var lastOutcome: String?
    @Published private(set) var lastRefreshed: Date?

    private var pollTask: Task<Void, Never>?

    var isReachable: Bool { status != nil }

    /// Poll while the window is open. Two seconds is the daemon's own debounce for
    /// publishing, so faster polling would only read the same bytes again.
    func startPolling(interval: TimeInterval = 3) {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        do {
            let raw = try await RelaySocket.request(["cmd": "status"])
            status = RelayStatus(raw)
            lastError = nil
            lastRefreshed = Date()
        } catch {
            // Keep the last known status on screen but say it is stale: a relay
            // that stopped is different from a relay that changed.
            lastError = error.localizedDescription
        }
    }

    /// Send one command and report the result. Never throws: every failure becomes
    /// a message, because the UI has to stay usable after one.
    func perform(_ cmd: String, _ args: [String: Any] = [:]) async {
        guard !busy else { return }
        busy = true
        lastOutcome = nil
        defer { busy = false }

        do {
            var payload = args
            payload["cmd"] = cmd
            _ = try await RelaySocket.request(payload)
            lastOutcome = Self.describe(cmd)
            await refresh()
        } catch {
            lastOutcome = error.localizedDescription
        }
    }

    private static func describe(_ cmd: String) -> String {
        switch cmd {
        case "pause": return "Seeding paused."
        case "resume": return "Seeding resumed."
        case "pin": return "Region pinned; the relay is fetching its blocks."
        case "unpin": return "Region unpinned."
        case "set-budget": return "Budget updated."
        case "evict-idle": return "Idle regions checked."
        case "shutdown": return "Relay stopped."
        default: return "Done."
        }
    }

    /// Stop the relay for good: ask the daemon to exit, then unload and disable the
    /// login item so it does not come back. Quit has to mean quit.
    func shutdownRelay() async {
        busy = true
        defer { busy = false }
        _ = try? await RelaySocket.request(["cmd": "shutdown"], timeout: 4)
        for _ in 0..<25 {
            if (try? await RelaySocket.request(["cmd": "status"], timeout: 1)) == nil { break }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        LaunchControl.run(["bootout", LaunchControl.domain + "/" + LaunchControl.agentLabel])
        LaunchControl.run(["disable", LaunchControl.domain + "/" + LaunchControl.agentLabel])
        status = nil
        lastOutcome = "Relay stopped and disabled. Use Start relay to bring it back."
    }

    /// Bring it back after a Quit, from the UI rather than a terminal.
    func startRelay() async {
        busy = true
        defer { busy = false }
        LaunchControl.run(["enable", LaunchControl.domain + "/" + LaunchControl.agentLabel])
        LaunchControl.run([
            "bootstrap", LaunchControl.domain, LaunchControl.agentPlist,
        ])
        // Give launchd a moment to start Node before asking for status.
        try? await Task.sleep(nanoseconds: 2_500_000_000)
        await refresh()
        lastOutcome = status == nil
            ? "The relay did not start. Check ~/Library/Logs/Polaris Relay/relay.error.log."
            : "Relay started."
    }
}

/// The two launchd jobs this app owns: the seeder, and itself.
enum LaunchControl {
    static var domain: String { "gui/\(getuid())" }
    static let agentLabel = "app.polarismaps.relay"
    static let controllerLabel = "app.polarismaps.relay.controller"

    /// The daemon's plist. Resolved through `HOME` so a user-level install and the
    /// installer agree without the app needing to be told.
    static var agentPlist: String {
        (FileManager.default.homeDirectoryForCurrentUser.path as NSString)
            .appendingPathComponent("Library/LaunchAgents/\(agentLabel).plist")
    }

    @discardableResult
    static func run(_ arguments: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            return -1
        }
    }
}
