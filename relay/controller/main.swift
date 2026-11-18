// Polaris Relay — menu-bar controller.
//
// The relay's own UI. It reads state from the daemon over the local control socket
// and sends it commands.
//
// **Quitting this app stops the relay.** That is deliberate and it is the only
// sane reading of a Quit: the user just told the relay's own window they are done,
// so seeding must end, the daemon must exit cleanly, and the launch agent must be
// unloaded and disabled so it does not quietly come back at the next login. A
// menu-bar app that keeps uploading after Quit is precisely the hostile
// background-service pattern this project should not ship.
//
// What stays true is the other half of the original rule: quitting *Polaris Maps*
// does not stop the relay, because that is a different app and a different
// intention. The two are separate processes for exactly that reason.
//
// Deliberately one file and no Xcode project: this is a status item with a menu,
// and keeping it buildable with `swiftc` means it can be verified in CI-less
// environments and reviewed as code rather than as a pbxproj diff. Anything that
// grows beyond menus and budget fields should get a project instead.
//
// Build: ./build.sh (see relay/controller/README.md)

import AppKit
import Foundation

// MARK: - Control socket client

/// Newline-delimited JSON over a Unix socket, matching `relay/src/control.mjs`.
enum Control {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func socketPath() -> String {
        if let override = ProcessInfo.processInfo.environment["POLARIS_RELAY_HOME"], !override.isEmpty {
            return (override as NSString).appendingPathComponent("control.sock")
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return (home as NSString).appendingPathComponent(
            "Library/Application Support/Polaris Relay/control.sock"
        )
    }

    /// Send one command and decode the `result` object.
    static func request(_ payload: [String: Any], timeout: TimeInterval = 5) throws -> [String: Any] {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Failure(message: "could not create socket") }
        defer { close(fd) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let path = socketPath()
        let maxLength = MemoryLayout.size(ofValue: address.sun_path)
        guard path.utf8.count < maxLength else { throw Failure(message: "socket path too long") }
        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: maxLength) { buffer in
                _ = strcpy(buffer, path)
            }
        }

        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                connect(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else {
            throw Failure(message: "relay is not running (no control socket)")
        }

        var timeval = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeval, socklen_t(MemoryLayout<timeval>.size))

        var body = try JSONSerialization.data(withJSONObject: payload)
        body.append(0x0a)
        body.withUnsafeBytes { raw in
            _ = write(fd, raw.baseAddress, raw.count)
        }

        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 8192)
        while true {
            let count = read(fd, &buffer, buffer.count)
            if count <= 0 { break }
            response.append(buffer, count: count)
            if response.contains(0x0a) { break }
        }

        guard !response.isEmpty else { throw Failure(message: "relay closed the connection") }
        guard
            let object = try JSONSerialization.jsonObject(with: response) as? [String: Any]
        else {
            throw Failure(message: "unparseable reply")
        }
        if let ok = object["ok"] as? Bool, ok, let result = object["result"] as? [String: Any] {
            return result
        }
        throw Failure(message: object["error"] as? String ?? "relay rejected the command")
    }
}

// MARK: - Status model

struct RelayStatus {
    var serving = false
    var pauseReason: String?
    var power = "unknown"
    var lowPowerMode = false
    var relayPubkey = ""
    var pins: [String] = []
    var drives: [(regionId: String, peers: Int, bytes: Double)] = []
    var egressUsed: Double = 0
    var egressCap: Double = 0
    var servedBytes24h: Double = 0

    init(_ raw: [String: Any]) {
        serving = raw["serving"] as? Bool ?? false
        pauseReason = raw["pauseReason"] as? String
        power = raw["power"] as? String ?? "unknown"
        lowPowerMode = raw["lowPowerMode"] as? Bool ?? false
        relayPubkey = raw["relayPubkey"] as? String ?? ""

        if let pins = raw["pins"] as? [[String: Any]] {
            self.pins = pins.compactMap { $0["regionId"] as? String }
        }
        if let drives = raw["drives"] as? [[String: Any]] {
            self.drives = drives.compactMap { entry in
                guard let regionId = entry["regionId"] as? String else { return nil }
                return (
                    regionId,
                    entry["peers"] as? Int ?? 0,
                    (entry["bytes"] as? NSNumber)?.doubleValue ?? 0
                )
            }
        }
        if let usage = raw["usage"] as? [String: Any] {
            egressUsed = (usage["usedBytes"] as? NSNumber)?.doubleValue ?? 0
            egressCap = (usage["capBytes"] as? NSNumber)?.doubleValue ?? 0
            servedBytes24h = (usage["servedBytes24h"] as? NSNumber)?.doubleValue ?? 0
        }
    }

    static func gigabytes(_ bytes: Double) -> String {
        String(format: "%.1f GiB", bytes / 1_073_741_824)
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private var lastStatus: RelayStatus?
    private var lastError: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "antenna.radiowaves.left.and.right",
            accessibilityDescription: "Polaris Relay"
        )
        statusItem.button?.image?.isTemplate = true

        statusItem.menu = NSMenu()
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
    }

    private func refresh() {
        do {
            let status = RelayStatus(try Control.request(["cmd": "status"]))
            lastStatus = status
            lastError = nil
            apply(status)
        } catch {
            lastStatus = nil
            lastError = error.localizedDescription
            apply(nil)
        }
    }

    private func apply(_ status: RelayStatus?) {
        let menu = NSMenu()

        if let status {
            let headline = status.serving
                ? "Seeding — \(status.drives.count) region\(status.drives.count == 1 ? "" : "s")"
                : "Paused — \(status.pauseReason ?? "unknown reason")"
            menu.addItem(disabled(headline))

            if status.lowPowerMode {
                menu.addItem(disabled("Low Power Mode is on"))
            } else {
                menu.addItem(disabled("Power: \(status.power)"))
            }
            menu.addItem(
                disabled("Served today: \(RelayStatus.gigabytes(status.servedBytes24h))")
            )
            menu.addItem(
                disabled(
                    "This month: \(RelayStatus.gigabytes(status.egressUsed)) of "
                        + RelayStatus.gigabytes(status.egressCap)
                )
            )

            for drive in status.drives {
                menu.addItem(
                    disabled(
                        "• \(drive.regionId) — \(drive.peers) peer"
                            + (drive.peers == 1 ? "" : "s")
                            + ", \(RelayStatus.gigabytes(drive.bytes))"
                    )
                )
            }

            menu.addItem(.separator())
            menu.addItem(
                item(status.serving ? "Pause seeding" : "Resume seeding", #selector(togglePause))
            )
            menu.addItem(
                item("Seed on battery power: \(seedOnBatteryLabel())", #selector(toggleBattery))
            )
        } else {
            menu.addItem(disabled("Relay is not running"))
            menu.addItem(disabled(lastError ?? "unknown error"))
            menu.addItem(.separator())
            menu.addItem(disabled("Not running — nothing is being seeded"))
            menu.addItem(item("Start relay", #selector(startRelay)))
            menu.addItem(disabled("Install: relay/launchd/install.sh"))
        }

        menu.addItem(.separator())
        menu.addItem(item("Quit Polaris Relay (stops seeding)", #selector(quit)))
        statusItem.menu = menu
    }

    private func seedOnBatteryLabel() -> String {
        // Read back from the daemon's config so the menu cannot drift from it.
        guard let raw = try? Control.request(["cmd": "status"]),
              let preferences = raw["preferences"] as? [String: Any],
              let value = preferences["seedOnBattery"] as? Bool
        else {
            return "unknown"
        }
        return value ? "on" : "off"
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private func item(_ title: String, _ selector: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func togglePause() {
        let command = (lastStatus?.serving ?? false) ? "pause" : "resume"
        _ = try? Control.request(["cmd": command])
        refresh()
    }

    @objc private func toggleBattery() {
        let enable = seedOnBatteryLabel() != "on"
        _ = try? Control.request(["cmd": "set-budget", "seedOnBattery": enable])
        refresh()
    }

    /// Quit means quit: stop seeding, then unload and disable the launch agent.
    ///
    /// Order matters. `shutdown` makes the daemon unseed and exit 0 (the agent's
    /// `KeepAlive{SuccessfulExit:false}` then leaves it stopped); `bootout`
    /// unloads it now; `disable` stops it returning at the next login. If the
    /// daemon does not answer — wedged, or never started — the launchd calls still
    /// run, so Quit cannot fail to stop seeding.
    @objc private func quit() {
        _ = try? Control.request(["cmd": "shutdown"], timeout: 3)
        for _ in 0..<25 {
            if (try? Control.request(["cmd": "status"], timeout: 1)) == nil { break }
            Thread.sleep(forTimeInterval: 0.2)
        }
        runLaunchctl(["bootout", agentDomain, label])
        runLaunchctl(["disable", "\(agentDomain)/\(label)"])
        NSApp.terminate(nil)
    }

    /// Start it again without a terminal, for people who quit by accident.
    @objc private func startRelay() {
        runLaunchctl(["enable", "\(agentDomain)/\(label)"])
        runLaunchctl(["bootstrap", agentDomain, plistPath])
        refresh()
    }

    private var agentDomain: String { "gui/\(getuid())" }
    private let label = "app.polarismaps.relay"
    private var plistPath: String {
        (FileManager.default.homeDirectoryForCurrentUser.path as NSString)
            .appendingPathComponent("Library/LaunchAgents/app.polarismaps.relay.plist")
    }

    @discardableResult
    private func runLaunchctl(_ arguments: [String]) -> Int32 {
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

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
