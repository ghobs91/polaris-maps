import AppKit
import SwiftUI

/// Polaris Relay — menu-bar app for the desktop seeder.
///
/// This is the macOS UI for the relay. It talks to the daemon over the local
/// control socket (`~/Library/Application Support/Polaris Relay/control.sock`), so
/// it needs no network, no Gun relay and no iOS app: the dashboard and the daemon
/// are on the same machine.
///
/// Two behaviours worth stating, because both are choices:
///
///   - **Quitting stops the relay.** Seeding ends, the daemon exits, and the login
///     item is disabled so it does not return at the next login. A background
///     service that keeps uploading after its own window closes is the hostile
///     pattern to avoid; "Start relay" is one click away.
///   - **The window does not open at login.** The app is a login item, so it starts
///     with the session in the menu bar only; the dashboard is opened on demand.
@main
struct PolarisRelayApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = RelayStore.shared

    init() {
        // `--selftest` exercises the socket client and the status decoding without
        // a GUI, so the installer and CI can prove the app can talk to the daemon.
        if CommandLine.arguments.contains("--selftest") {
            exit(RelaySocket.selfTest(catalog: CommandLine.arguments.contains("--catalog")))
        }
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarContent().environmentObject(store)
        } label: {
            Image(systemName: "antenna.radiowaves.left.and.right")
        }
        .menuBarExtraStyle(.menu)
    }
}

/// Handles `--open-dashboard`, which exists so the window can be opened without a
/// mouse (verification, and a shortcut for anyone who wants one).
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Any termination stops the relay, whatever triggered it. The menu item is the
    /// documented path; this is the one that also covers Cmd-Q, a crash reporter's
    /// "quit", and anyone who force-quits from Activity Monitor.
    func applicationWillTerminate(_ notification: Notification) {
        RelaySocket.shutdownRelayBlocking()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--open-dashboard") {
            MainActor.assumeIsolated {
                DashboardWindow.show(store: RelayStore.shared)
            }
        }
    }
}
