import SwiftUI

/// The catalog browser: search, list, map, and one action.
///
/// This replaces the text field that asked for 64 hex characters. Every region the
/// published catalog advertises is here — on the map, searchable, grouped — and the
/// only thing that differs between them is whether a **verified manimant** gives a
/// canonical key. That is shown honestly rather than hidden: "no signed manifest
/// published yet" is a fact about the network, not a bug in the app.
struct RegionCatalogView: View {
    /// Pin a region that has a verified manifest (the relay resolves the key).
    let onPin: (String) -> Void
    /// Pin a region with a key the user supplied (the "Advanced…" path).
    let onPinWithKey: (String, String, String, Int) -> Void
    let onCancel: () -> Void

    @State private var snapshot: CatalogSnapshot?
    /// Show only regions the relay can actually seed. On by default: a catalog where
    /// 354 of 355 rows are dead weight is not a catalog, it is a list of things you
    /// cannot do.
    @State private var readyOnly = true
    @State private var selectedId: String?
    @State private var search = ""
    @State private var loading = true
    @State private var error: String?
    @State private var showingManual = false
    @State private var publishing: String?
    @State private var publishError: String?

    private var filtered: [CatalogRegion] {
        guard let regions = snapshot?.regions else { return [] }
        let needle = search.lowercased()
        return regions.filter { region in
            if readyOnly && !region.pinnable { return false }
            guard !needle.isEmpty else { return true }
            return region.name.lowercased().contains(needle)
                || region.regionId.lowercased().contains(needle)
        }
    }

    private var selected: CatalogRegion? {
        snapshot?.regions.first { $0.regionId == selectedId }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if loading {
                ProgressView("Loading the region catalog…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error, snapshot?.regions.isEmpty != false {
                unavailable(error)
            } else {
                HSplitView {
                    regionList
                    mapPane
                }
            }
            if let publishError {
                Text(publishError)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            footer
        }
        .frame(minWidth: 820, idealWidth: 900, minHeight: 560, idealHeight: 620)
        .task { await reload(force: false) }
        .sheet(isPresented: $showingManual) {
            PinRegionSheet { regionId, driveKey, version, bytes in
                showingManual = false
                // Pass the entered key through: this used to call `onPin(regionId)` and
                // silently drop it, so "Advanced…" pinned a region that had no manifest
                // and always failed.
                onPinWithKey(regionId, driveKey, version, bytes)
            } onCancel: {
                showingManual = false
            }
        }
    }

    // MARK: - Pieces

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Map catalog").font(.title3.weight(.semibold))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("Ready only", isOn: $readyOnly)
                .toggleStyle(.checkbox)
                .help("Show only regions with a verified manifest, which are the ones a relay can seed")
            TextField("Search regions", text: $search)
                .textFieldStyle(.roundedBorder)
                .frame(width: 200)
            Button {
                Task { await reload(force: true) }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .help("Refresh from the catalog")
            .disabled(loading)
        }
        .padding(14)
    }

    private var subtitle: String {
        guard let snapshot else { return "loading…" }
        let source = snapshot.source == "network" ? "fetched just now" : snapshot.source
        let ready = snapshot.pinnableCount
        return "\(snapshot.regions.count) regions · \(ready) ready to seed"
            + " · \(source)"
            + (snapshot.error.map { " · \($0)" } ?? "")
    }

    private var regionList: some View {
        VStack(spacing: 0) {
            List(selection: $selectedId) {
                ForEach(filtered) { region in
                    RegionRow(region: region).tag(region.regionId)
                }
            }
            .listStyle(.inset)
            .frame(minWidth: 300)
        }
    }

    private var mapPane: some View {
        ZStack(alignment: .bottom) {
            RegionMapView(
                regions: filtered.isEmpty ? (snapshot?.regions ?? []) : filtered,
                selectedId: selectedId,
                onSelect: { selectedId = $0 }
            )
            if filtered.isEmpty && !loading {
                Text(readyOnly ? "No region here has a signed manifest yet — turn off Ready only to see all \(snapshot?.regions.count ?? 0)." : "Nothing matches that search.")
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .padding(10)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding(14)
            } else if let selected {
                selectionCard(selected)
            } else {
                Text("Click a region to select it")
                    .font(.caption)
                    .padding(8)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding(12)
            }
        }
        .frame(minWidth: 440)
    }

    private func selectionCard(_ region: CatalogRegion) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(region.name).font(.headline)
                Spacer()
                if region.pinned {
                    Text("pinned").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("\(region.regionId) · \(region.sizeLabel) · \(region.version)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(statusLine(for: region))
                .font(.caption)
                .foregroundStyle(region.pinnable ? Color.secondary : Color.orange)
            HStack {
                if region.pinnable {
                    Button("Pin this region") { onPin(region.regionId) }
                        .disabled(region.pinned)
                } else {
                    // No manifest yet: this relay can become the publisher. It fetches
                    // the pack from the catalog (md5-verified), authors the canonical
                    // drive and signs a manifest for it.
                    Button(publishing == region.regionId ? "Publishing…" : "Publish & seed") {
                        Task { await publish(region) }
                    }
                    .disabled(region.pinned || publishing != nil)
                }
                Button("Advanced…") { showingManual = true }
                    .buttonStyle(.borderless)
                Spacer()
            }
            if publishing == region.regionId {
                Text("Fetching the pack, authoring the canonical drive and signing a manifest. Large regions take a few minutes.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: 380, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .padding(14)
    }

    private func statusLine(for region: CatalogRegion) -> String {
        if region.pinnable {
            let source = region.manifestSource ?? "verified"
            return "Canonical key from \(source) manifest — the relay can seed this."
        }
        return "Not pinnable: \(region.reason ?? "no signed manifest published")."
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Text(
                "A relay can only seed a pack whose canonical key a trusted publisher signed. "
                    + "Regions without one are shown so you can see what is coming."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            Spacer()
            Button("Enter a key manually…") { showingManual = true }
                .buttonStyle(.borderless)
            Button("Close") { onCancel() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(12)
    }

    private func unavailable(_ message: String) -> some View {
        VStack(spacing: 10) {
            Text("The region catalog is unavailable").font(.headline)
            Text(message).font(.callout).foregroundStyle(.secondary)
            Button("Try again") { Task { await reload(force: true) } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    // MARK: - Loading

    /// Relay-as-publisher for one region, then refresh so the row flips to "ready".
    private func publish(_ region: CatalogRegion) async {
        publishing = region.regionId
        publishError = nil
        defer { publishing = nil }

        do {
            let raw = try await RelaySocket.request(
                ["cmd": "publish-region", "regionId": region.regionId],
                timeout: 1_800
            )
            if let manifest = raw["manifest"] as? [String: Any] {
                let bytes = RelayStatus.number(manifest["bytes"])
                publishError = "Published. This relay is now the canonical seeder for \(region.name) (\(ByteFormat.gib(bytes)))."
            }
            await reload(force: false)
            selectedId = region.regionId
        } catch {
            publishError = error.localizedDescription
        }
    }

    private func reload(force: Bool) async {
        loading = true
        error = nil
        let loaded = await RelayStore.shared.loadCatalog(force: force)
        snapshot = loaded
        if loaded == nil || loaded?.regions.isEmpty == true {
            error = RelayStore.shared.lastCatalogError
                ?? loaded?.error
                ?? "the relay returned no regions"
        }
        if selectedId == nil {
            selectedId = loaded?.regions.first(where: { $0.pinnable })?.regionId
                ?? loaded?.regions.first?.regionId
        }
        loading = false
    }
}

private struct RegionRow: View {
    let region: CatalogRegion

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: region.pinnable ? "checkmark.seal.fill" : "circle.dashed")
                .foregroundStyle(region.pinnable ? Color.teal : Color.secondary)
                .help(region.pinnable ? "has a verified manifest" : "no verified manifest yet")
            VStack(alignment: .leading, spacing: 1) {
                Text(region.name).font(.callout)
                Text("\(region.regionId) · \(region.sizeLabel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if region.pinned {
                Text("pinned").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 1)
        .opacity(region.pinnable ? 1 : 0.6)
    }
}
