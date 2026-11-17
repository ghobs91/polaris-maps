// Polaris Relay — menu-bar controller.
//
// A controller, not the service. It reads state from the running daemon over the
// local control socket and sends it commands. Quitting it does **not** stop
// seeding: the daemon is a launch agent, and that separation is the entire point
// of the design (a seeding process with an app's lifetime reproduces the phone's
// problem at desktop scale).
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
            menu.addItem(disabled("Install: relay/launchd/install.sh"))
        }

        menu.addItem(.separator())
        // The distinction the whole design rests on: this quits the controller,
        // not the seeder.
        menu.addItem(disabled("Quitting this menu does not stop seeding"))
        menu.addItem(item("Quit menu bar app", #selector(quit)))
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

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
