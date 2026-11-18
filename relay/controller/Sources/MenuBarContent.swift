import AppKit
import SwiftUI

/// Menu-bar content: the summary you can read without opening a window, plus the
/// two things a user actually reaches for (pause, quit).
struct MenuBarContent: View {
    @EnvironmentObject private var store: RelayStore
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Group {
            if let status = store.status {
                Text(status.serving ? "Seeding" : "Paused — \(status.pauseReason ?? "unknown")")
                Text(
                    "\(status.drives.count) region\(status.drives.count == 1 ? "" : "s") · "
                        + "\(ByteFormat.gib(status.servedBytes24h)) served today"
                )
                Divider()
                Button(status.serving ? "Pause seeding" : "Resume seeding") {
                    Task { await store.perform(status.serving ? "pause" : "resume") }
                }
                Button("Open dashboard…") { DashboardWindow.show(store: store) }
            } else {
                Text("Relay is not running")
                Button("Start relay") { Task { await store.startRelay() } }
                Button("Open dashboard…") { DashboardWindow.show(store: store) }
            }
            Divider()
            Button("Quit Polaris Relay (stops seeding)") {
                Task {
                    await store.shutdownRelay()
                    await MainActor.run { NSApp.terminate(nil) }
                }
            }
            .keyboardShortcut("q")
        }
    }
}

/// The dashboard window, owned by AppKit.
///
/// A SwiftUI `Window` scene would also open at every login, which is wrong for a
/// login item: the relay should be visible in the menu bar and quiet until asked.
/// Owning the `NSWindow` here means the window exists only when the user opens it.
@MainActor
enum DashboardWindow {
    private static var controller: NSWindowController?

    static func show(store: RelayStore) {
        NSApp.activate(ignoringOtherApps: true)

        if let window = controller?.window {
            window.makeKeyAndOrderFront(nil)
            return
        }

        let root = DashboardView().environmentObject(store)
        let hosting = NSHostingController(rootView: root)
        let window = NSWindow(contentViewController: hosting)
        window.title = "Polaris Relay"
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.setContentSize(NSSize(width: 560, height: 720))
        window.center()
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("PolarisRelayDashboard")

        let windowController = NSWindowController(window: window)
        controller = windowController
        windowController.showWindow(nil)
    }
}
