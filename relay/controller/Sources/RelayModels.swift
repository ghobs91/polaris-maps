import Foundation

/// The relay's status, as the daemon reports it (`buildStatus` in
/// `relay/src/daemon.mjs`). Parsed defensively: a missing or mistyped field must
/// degrade one row of the UI, never the whole window.

struct RelayDrive: Identifiable, Equatable {
    var id: String { regionId }
    let regionId: String
    let peers: Int
    let bytes: Double
    let pinned: Bool
    let lastRequestedAt: Double
    let readOnly: Bool
}

struct RelayDevice: Identifiable, Equatable {
    var id: String { pubkey }
    let pubkey: String
    let label: String
    let authorizedAt: Double
}

struct RelayStatus: Equatable {
    var serving = false
    var pauseReason: String?
    var power = "unknown"
    var lowPowerMode = false
    var metered = false
    var relayPubkey = ""
    var uptimeSec = 0
    var drives: [RelayDrive] = []
    var pins: [String] = []
    var devices: [RelayDevice] = []
    var egressUsed: Double = 0
    var egressCap: Double = 0
    var servedBytes24h: Double = 0
    var storeUsed: Double = 0
    var storeCap: Double = 0
    var maxPeers = 0
    var maxBitsPerSecond: Double = 0
    var seedOnBattery = false
    var seedOnMetered = false
    var configWarnings: [String] = []
    var errors: [String] = []

    static func number(_ value: Any?) -> Double {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String, let parsed = Double(string) { return parsed }
        return 0
    }

    static func integer(_ value: Any?) -> Int {
        Int(number(value))
    }

    init() {}

    init(_ raw: [String: Any]) {
        serving = raw["serving"] as? Bool ?? false
        pauseReason = raw["pauseReason"] as? String
        power = raw["power"] as? String ?? "unknown"
        lowPowerMode = raw["lowPowerMode"] as? Bool ?? false
        metered = raw["metered"] as? Bool ?? false
        relayPubkey = raw["relayPubkey"] as? String ?? ""
        uptimeSec = Self.integer(raw["uptimeSec"])

        if let pins = raw["pins"] as? [[String: Any]] {
            self.pins = pins.compactMap { $0["regionId"] as? String }
        }

        if let drives = raw["drives"] as? [[String: Any]] {
            self.drives = drives.compactMap { entry in
                guard let regionId = entry["regionId"] as? String else { return nil }
                return RelayDrive(
                    regionId: regionId,
                    peers: Self.integer(entry["peers"]),
                    bytes: Self.number(entry["bytes"]),
                    pinned: entry["pinned"] as? Bool ?? false,
                    lastRequestedAt: Self.number(entry["lastRequestedAt"]),
                    readOnly: entry["readOnly"] as? Bool ?? true
                )
            }
        }

        if let devices = raw["devices"] as? [[String: Any]] {
            self.devices = devices.compactMap { entry in
                guard let pubkey = entry["pubkey"] as? String else { return nil }
                return RelayDevice(
                    pubkey: pubkey,
                    label: entry["label"] as? String ?? "device",
                    authorizedAt: Self.number(entry["authorizedAt"])
                )
            }
        }

        if let usage = raw["usage"] as? [String: Any] {
            egressUsed = Self.number(usage["usedBytes"])
            egressCap = Self.number(usage["capBytes"])
            servedBytes24h = Self.number(usage["servedBytes24h"])
        }

        if let budgets = raw["budgets"] as? [String: Any] {
            storeUsed = Self.number(budgets["usedBytes"])
            storeCap = Self.number(budgets["packStoreBytes"])
            maxPeers = Self.integer(budgets["maxPeers"])
            maxBitsPerSecond = Self.number(budgets["maxBitsPerSecond"])
        }

        if let preferences = raw["preferences"] as? [String: Any] {
            seedOnBattery = preferences["seedOnBattery"] as? Bool ?? false
            seedOnMetered = preferences["seedOnMetered"] as? Bool ?? false
        }

        configWarnings = raw["configWarnings"] as? [String] ?? []
        errors = raw["errors"] as? [String] ?? []
    }

    var shortKey: String { String(relayPubkey.prefix(12)) }

    var uptimeDescription: String {
        let minutes = uptimeSec / 60
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }

    var storeFraction: Double {
        guard storeCap > 0 else { return 0 }
        return min(1, storeUsed / storeCap)
    }

    var egressFraction: Double {
        guard egressCap > 0 else { return 0 }
        return min(1, egressUsed / egressCap)
    }
}

enum ByteFormat {
    static func gib(_ bytes: Double) -> String {
        if bytes < 1_073_741_824 { return String(format: "%.0f MB", bytes / 1_048_576) }
        return String(format: "%.1f GiB", bytes / 1_073_741_824)
    }

    static func gb(_ bytes: Double) -> String {
        String(format: "%.1f GB", bytes / 1_000_000_000)
    }

    static func age(_ epochMs: Double) -> String {
        guard epochMs > 0 else { return "never" }
        let seconds = max(0, (Date().timeIntervalSince1970 * 1000 - epochMs) / 1000)
        if seconds < 90 { return "just now" }
        if seconds < 5_400 { return "\(Int(seconds / 60)) min ago" }
        if seconds < 172_800 { return "\(Int(seconds / 3_600)) h ago" }
        return "\(Int(seconds / 86_400)) d ago"
    }
}
