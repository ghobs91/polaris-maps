import Foundation

/// One region in the desktop catalog.
///
/// Mirrors what `catalogRegions` in `relay/src/manifests.mjs` returns: every region
/// the published catalog advertises, whether or not a canonical key is known for it.
struct CatalogRegion: Identifiable, Equatable {
    var id: String { regionId }
    let regionId: String
    let name: String
    let version: String
    let bytes: Double
    let bounds: RegionBounds?
    let pinned: Bool
    let pinnable: Bool
    /// "bundled", "gossip" or "catalog" when pinnable — where the key came from.
    let manifestSource: String?
    /// Why it cannot be pinned, when it cannot.
    let reason: String?

    var sizeLabel: String { bytes > 0 ? ByteFormat.gib(bytes) : "size unknown" }

    /// Grouping for the list: the catalog ids start with a continent/area slug.
    var area: String {
        let prefix = regionId.split(separator: "-").first.map(String.init) ?? ""
        return prefix.isEmpty ? "other" : prefix
    }
}

struct RegionBounds: Equatable {
    let minLat: Double
    let maxLat: Double
    let minLng: Double
    let maxLng: Double

    var centerLat: Double { (minLat + maxLat) / 2 }
    var centerLng: Double { (minLng + maxLng) / 2 }
}

struct CatalogSnapshot: Equatable {
    var regions: [CatalogRegion] = []
    var source = "none"
    var fetchedAt: Double = 0
    var error: String?
    var assetTag: String?
    var problems: [String] = []

    var pinnableCount: Int { regions.filter { $0.pinnable }.count }
    var pinnedCount: Int { regions.filter { $0.pinned }.count }

    static func parse(_ raw: [String: Any]) -> CatalogSnapshot {
        var snapshot = CatalogSnapshot()
        snapshot.source = raw["source"] as? String ?? "none"
        snapshot.fetchedAt = RelayStatus.number(raw["fetchedAt"])
        snapshot.error = raw["error"] as? String
        snapshot.assetTag = raw["assetTag"] as? String

        if let problems = raw["problems"] as? [[String: Any]] {
            snapshot.problems = problems.map {
                "\($0["regionId"] as? String ?? "?") (\($0["source"] as? String ?? "?")): "
                    + "\($0["reason"] as? String ?? "unknown")"
            }
        }

        snapshot.regions = (raw["regions"] as? [[String: Any]] ?? []).compactMap { entry in
            guard let regionId = entry["regionId"] as? String else { return nil }
            var bounds: RegionBounds?
            if let raw = entry["bounds"] as? [String: Any] {
                let minLat = RelayStatus.number(raw["minLat"])
                let maxLat = RelayStatus.number(raw["maxLat"])
                let minLng = RelayStatus.number(raw["minLng"])
                let maxLng = RelayStatus.number(raw["maxLng"])
                if maxLat != 0 || maxLng != 0 {
                    bounds = RegionBounds(
                        minLat: minLat,
                        maxLat: maxLat,
                        minLng: minLng,
                        maxLng: maxLng
                    )
                }
            }
            return CatalogRegion(
                regionId: regionId,
                name: entry["name"] as? String ?? regionId,
                version: entry["version"] as? String ?? "unknown",
                bytes: RelayStatus.number(entry["bytes"]),
                bounds: bounds,
                pinned: entry["pinned"] as? Bool ?? false,
                pinnable: entry["pinnable"] as? Bool ?? false,
                manifestSource: entry["manifestSource"] as? String,
                reason: entry["reason"] as? String
            )
        }
        return snapshot
    }
}

extension RelayStore {
    /// Load the region catalog from the daemon (cached there for six hours).
    func loadCatalog(force: Bool = false) async -> CatalogSnapshot? {
        do {
            let raw = try await RelaySocket.request(
                ["cmd": force ? "refresh-catalog" : "catalog"],
                timeout: 30
            )
            return CatalogSnapshot.parse(raw)
        } catch {
            lastCatalogError = error.localizedDescription
            return nil
        }
    }
}
