import SwiftUI

/// The dashboard window.
///
/// Every value on screen is something the daemon reported in the last poll; when a
/// poll fails the last known numbers stay but the window says the relay is
/// unreachable, because "the relay stopped" and "the relay changed" are not the
/// same thing and the difference matters when the answer is "why is nothing
/// seeding".
struct DashboardView: View {
    @EnvironmentObject private var store: RelayStore
    @State private var showingCatalog = false
    @State private var showingManualPin = false
    @State private var confirmingShutdown = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let status = store.status {
                    if let outcome = store.lastOutcome {
                        Notice(text: outcome, tone: .neutral)
                    }
                    overview(status)
                    regions(status)
                    budgets(status)
                    behaviour(status)
                    devices(status)
                    diagnostics(status)
                } else {
                    unreachable
                }
                footer
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 520, minHeight: 560)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear { store.startPolling() }
        .sheet(isPresented: $showingCatalog) {
            RegionCatalogView { regionId in
                showingCatalog = false
                Task { await store.perform("pin-region", ["regionId": regionId]) }
            } onCancel: {
                showingCatalog = false
            }
        }
        .sheet(isPresented: $showingManualPin) {
            PinRegionSheet { regionId, driveKey, version, bytes in
                showingManualPin = false
                Task {
                    await store.perform("pin", [
                        "regionId": regionId,
                        "driveKey": driveKey,
                        "version": version,
                        "bytes": bytes,
                    ])
                }
            } onCancel: {
                showingManualPin = false
            }
        }
        .alert("Stop the relay?", isPresented: $confirmingShutdown) {
            Button("Cancel", role: .cancel) {}
            Button("Stop relay", role: .destructive) {
                Task { await store.shutdownRelay() }
            }
        } message: {
            Text(
                "Seeding ends, the daemon exits and the login item is disabled, so it will not "
                    + "come back at the next login. You can start it again from this window."
            )
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Polaris Relay").font(.title2.weight(.semibold))
                if let status = store.status {
                    Text("on this Mac · \(status.shortKey)…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if store.status == nil {
                Button("Start relay") { Task { await store.startRelay() } }
                    .disabled(store.busy)
            } else if let status = store.status {
                Button(status.serving ? "Pause" : "Resume") {
                    Task { await store.perform(status.serving ? "pause" : "resume") }
                }
                .disabled(store.busy)
            }
            Button {
                Task { await store.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .help("Refresh")
            .disabled(store.busy)
        }
    }

    // MARK: - Sections

    private func overview(_ status: RelayStatus) -> some View {
        Card("Status") {
            LabeledRow(
                label: "Seeding",
                value: status.serving ? "Yes" : "No",
                detail: status.serving ? nil : (status.pauseReason ?? "paused"),
                tone: status.serving ? .good : .warning
            )
            LabeledRow(
                label: "Power",
                value: status.power + (status.lowPowerMode ? " · low power mode" : ""),
                detail: status.seedOnBattery ? "seeding on battery is allowed" : nil
            )
            LabeledRow(label: "Served today", value: ByteFormat.gib(status.servedBytes24h))
            LabeledRow(label: "Uptime", value: status.uptimeDescription)
        }
    }

    private func regions(_ status: RelayStatus) -> some View {
        Card("Regions seeded", subtitle: status.drives.isEmpty ? nil : ByteFormat.gib(status.storeUsed) + " on disk") {
            if status.drives.isEmpty {
                Text(
                    "Nothing pinned yet. A relay only seeds what you pin — open the map catalog and "
                        + "pick the region you actually live in."
                )
                .font(.callout)
                .foregroundStyle(.secondary)
            } else {
                ForEach(status.drives) { drive in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(drive.regionId.replacingOccurrences(of: "-", with: " "))
                                .font(.callout.weight(.medium))
                            Text(
                                "\(drive.peers) peer\(drive.peers == 1 ? "" : "s") · "
                                    + ByteFormat.gib(drive.bytes)
                                    + (drive.pinned ? " · pinned" : "")
                                    + " · last requested \(ByteFormat.age(drive.lastRequestedAt))"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Unpin") {
                            Task { await store.perform("unpin", ["regionId": drive.regionId]) }
                        }
                        .buttonStyle(.borderless)
                        .disabled(store.busy)
                    }
                    .padding(.vertical, 2)
                }
            }
            HStack {
                Button("Browse map catalog…") { showingCatalog = true }.disabled(store.busy)
                Button("Enter a key manually…") { showingManualPin = true }
                    .buttonStyle(.borderless)
                    .disabled(store.busy)
                Spacer()
            }
            .padding(.top, 4)
        }
    }

    private func budgets(_ status: RelayStatus) -> some View {
        Card("Budgets") {
            LabeledRow(
                label: "Pack store",
                value: ByteFormat.gib(status.storeUsed) + " of " + ByteFormat.gib(status.storeCap)
            )
            ProgressView(value: status.storeFraction).controlSize(.small)
            Picker("Limit", selection: Binding(
                get: { Int(status.storeCap / 1_073_741_824) },
                set: { value in Task { await store.perform("set-budget", ["packStoreGb": value]) } }
            )) {
                Text("10 GiB").tag(10)
                Text("25 GiB").tag(25)
                Text("50 GiB").tag(50)
                Text("100 GiB").tag(100)
            }
            .pickerStyle(.segmented)

            LabeledRow(
                label: "This month",
                value: ByteFormat.gb(status.egressUsed)
                    + " of "
                    + (status.egressCap > 0 ? ByteFormat.gb(status.egressCap) : "unlimited")
            )
            ProgressView(value: status.egressFraction).controlSize(.small)
            Picker("Upload cap", selection: Binding(
                get: { Int((status.egressCap / 1_000_000_000).rounded()) },
                set: { value in Task { await store.perform("set-budget", ["egressGb": value]) } }
            )) {
                Text("50 GB").tag(50)
                Text("250 GB").tag(250)
                Text("500 GB").tag(500)
            }
            .pickerStyle(.segmented)

            LabeledRow(label: "Max peers", value: "\(status.maxPeers)")
        }
    }

    private func behaviour(_ status: RelayStatus) -> some View {
        Card(
            "When it seeds",
            subtitle: "Defaults protect this Mac: no seeding on battery, metered links or Low Power Mode."
        ) {
            Toggle("Seed on battery", isOn: Binding(
                get: { status.seedOnBattery },
                set: { value in Task { await store.perform("set-budget", ["seedOnBattery": value]) } }
            ))
            Toggle("Seed on metered connection", isOn: Binding(
                get: { status.seedOnMetered },
                set: { value in Task { await store.perform("set-budget", ["seedOnMetered": value]) } }
            ))
            HStack {
                Button("Drop idle regions") {
                    Task { await store.perform("evict-idle") }
                }
                .disabled(store.busy)
                Text("regions no peer has requested in 30 days")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
    }

    private func devices(_ status: RelayStatus) -> some View {
        Card(
            "Phones that can control this relay",
            subtitle: "Controls are signed. A phone that is not listed here can still download from this relay, but cannot change it."
        ) {
            if status.devices.isEmpty {
                Text(
                    "None. In Polaris Maps, open Settings → Offline maps → Desktop relay and run the "
                        + "authorize command it shows."
                )
                .font(.callout)
                .foregroundStyle(.secondary)
            } else {
                ForEach(status.devices) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(device.label).font(.callout.weight(.medium))
                            Text("\(device.pubkey.prefix(16))… · authorized \(ByteFormat.age(device.authorizedAt))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Revoke") {
                            Task {
                                await store.perform("revoke", ["devicePubkey": device.pubkey])
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(store.busy)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func diagnostics(_ status: RelayStatus) -> some View {
        Card("Diagnostics") {
            if status.configWarnings.isEmpty && status.errors.isEmpty {
                Text("No problems reported.").font(.callout).foregroundStyle(.secondary)
            }
            ForEach(status.configWarnings, id: \.self) { warning in
                Text(warning).font(.caption).foregroundStyle(.orange)
            }
            ForEach(status.errors, id: \.self) { error in
                Text(error).font(.caption).foregroundStyle(.red)
            }
            Text("Logs: ~/Library/Logs/Polaris Relay/")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
    }

    private var unreachable: some View {
        Card("Relay is not running") {
            Text(
                "Nothing is being seeded. Start it here, or re-run relay/launchd/install.sh if it was "
                    + "never installed."
            )
            .font(.callout)
            .foregroundStyle(.secondary)
            if let error = store.lastError {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            HStack {
                Button("Start relay") { Task { await store.startRelay() } }
                    .disabled(store.busy)
                Spacer()
            }
        }
    }

    private var footer: some View {
        HStack {
            Text("Quitting this app stops the relay.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Stop relay…") { confirmingShutdown = true }
                .buttonStyle(.borderless)
                .disabled(store.busy || store.status == nil)
        }
    }
}

// MARK: - Building blocks

private struct Card<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder let content: Content

    init(_ title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.headline)
                Spacer()
                if let subtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08))
        )
    }
}

private struct LabeledRow: View {
    enum Tone { case neutral, good, warning }

    let label: String
    let value: String
    var detail: String?
    var tone: Tone = .neutral

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(value)
                    .foregroundStyle(color)
                    .fontWeight(tone == .neutral ? .regular : .semibold)
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .font(.callout)
    }

    private var color: Color {
        switch tone {
        case .neutral: return .primary
        case .good: return .green
        case .warning: return .orange
        }
    }
}

private struct Notice: View {
    enum Tone { case neutral }
    let text: String
    let tone: Tone

    var body: some View {
        Text(text)
            .font(.callout)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.accentColor.opacity(0.12))
            )
    }
}
