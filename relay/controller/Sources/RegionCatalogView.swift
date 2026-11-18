import SwiftUI

/// The catalog browser: search, list, map, and one action.
///
/// This replaces the text field that asked for 64 hex characters. Every region the
/// published catalog advertises is here — on the map, searchable, grouped — and the
/// only thing that differs between them is whether a **verified manimant** gives a
/// canonical key. That is shown honestly rather than hidden: "no signed manifest
/// published yet" is a fact about the network, not a bug in the app.
struct RegionCatalogView: View {
    let onPin: (String) -> Void
    let onCancel: () -> Void

    @State private var snapshot: CatalogSnapshot?
    @State private var selectedId: String?
    @State private var search = ""
    @State private var loading = true
    @State private var error: String?
    @State private var showingManual = false

    private var filtered: [CatalogRegion] {
        guard let regions = snapshot?.regions else { return [] }
        guard !search.isEmpty else { return regions }
        let needle = search.lowercased()
        return regions.filter {
            $0.name.lowercased().contains(needle) || $0.regionId.lowercased().contains(needle)
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
            Divider()
            footer
        }
        .frame(minWidth: 820, idealWidth: 900, minHeight: 560, idealHeight: 620)
        .task { await reload(force: false) }
        .sheet(isPresented: $showingManual) {
            PinRegionSheet { regionId, driveKey, version, bytes in
                showingManual = false
                onPin(regionId)
                _ = (driveKey, version, bytes) // manual entry pins by key on the relay side
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
            TextField("Search regions", text: $search)
                .textFieldStyle(.roundedBorder)
                .frame(width: 220)
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
        return "\(snapshot.regions.count) regions · \(snapshot.pinnableCount) with a verified key"
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
            if let selected {
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
                Button("Pin this region") { onPin(region.regionId) }
                    .disabled(!region.pinnable || region.pinned)
                Button("Advanced…") { showingManual = true }
                    .buttonStyle(.borderless)
                Spacer()
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
