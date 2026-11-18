import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// Pair a phone by showing it a QR code.
///
/// The code carries a **one-time secret** that is valid for two minutes and is
/// handed out only over the local socket — never through gossip. Redeeming it
/// authorizes exactly one device, identified by the key that signs the redeem
/// request, so the scanning gesture *is* the consent: nothing is authorized until
/// somebody points a camera at this window.
struct PairPhoneSheet: View {
    @EnvironmentObject private var store: RelayStore
    @State private var payload: String?
    @State private var expiresAt: Double = 0
    @State private var secondsLeft = 0
    @State private var error: String?
    @State private var waiting = true

    private let onClose: () -> Void

    init(onClose: @escaping () -> Void) {
        self.onClose = onClose
    }

    var body: some View {
        VStack(spacing: 14) {
            Text("Link a phone").font(.title3.weight(.semibold))

            if let payload {
                if let image = QRCode.image(from: payload) {
                    Image(nsImage: image)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 240, height: 240)
                        .padding(10)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                }
                Text("Polaris Maps → Settings → Offline maps → Desktop relay → Link this phone")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                if waiting {
                    if secondsLeft > 0 {
                        Text("Code expires in \(secondsLeft)s · waiting for a phone…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("This code expired. Show a new one.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                } else {
                    Label("Phone linked", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                        .font(.callout)
                }
            } else if let error {
                Text(error).font(.callout).foregroundStyle(.orange)
                Button("Try again") { Task { await start() } }
            } else {
                ProgressView("Preparing a pairing code…")
            }

            Text(
                "The code authorizes one device for two minutes. It is created on this Mac and "
                    + "never leaves it except through this QR code."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)

            HStack {
                Button("Show a new code") { Task { await start() } }
                    .disabled(waiting && secondsLeft > 0)
                Spacer()
                Button("Done") {
                    Task { await cancelPairing() }
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 420)
        .task { await start() }
        // Watch for the device list growing: the phone pairs by signing with the
        // redeem request, so an authorized key appearing *is* the success signal.
        .task(id: store.status?.devices.count ?? 0) {
            while !Task.isCancelled {
                if let status = store.status, status.devices.count > devicesAtStart {
                    waiting = false
                    return
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                secondsLeft = max(0, Int((expiresAt - Date().timeIntervalSince1970 * 1000) / 1000))
            }
        }
    }

    @State private var devicesAtStart = 0

    private func start() async {
        error = nil
        waiting = true
        devicesAtStart = store.status?.devices.count ?? 0
        do {
            let raw = try await RelaySocket.request(["cmd": "pairing-start"])
            payload = raw["payload"] as? String
            expiresAt = RelayStatus.number(raw["expiresAt"])
            secondsLeft = max(0, Int((expiresAt - Date().timeIntervalSince1970 * 1000) / 1000))
        } catch {
            payload = nil
            self.error = error.localizedDescription
        }
    }

    private func cancelPairing() async {
        _ = try? await RelaySocket.request(["cmd": "pairing-cancel"])
        await store.refresh()
    }
}

/// QR rendering without a dependency: CoreImage's generator plus a scaled transform,
/// because the raw output is a few pixels per module and unusable at that size.
enum QRCode {
    static func image(from string: String, scale: CGFloat = 10) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }

        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: scaled.extent.width, height: scaled.extent.height))
    }
}
