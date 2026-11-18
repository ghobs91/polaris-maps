import SwiftUI

/// Pinning has to be explicit about the canonical key.
///
/// A relay replicates a pack by its canonical Hyperdrive key and **never authors**
/// one — that rule is what stops two seeders advertising different discovery keys,
/// which is the bug that made the whole mesh inert before. So this sheet asks for
/// the key, validates it is 64 hex characters, and explains where it comes from
/// rather than quietly generating something that would fork the pack.
struct PinRegionSheet: View {
    @State private var regionId = ""
    @State private var driveKey = ""
    @State private var version = ""
    @State private var bytes = ""

    let onPin: (String, String, String, Int) -> Void
    let onCancel: () -> Void

    private var keyIsValid: Bool {
        driveKey.count == 64 && driveKey.allSatisfy { $0.isHexDigit }
    }

    private var regionIsValid: Bool {
        !regionId.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var canPin: Bool { keyIsValid && regionIsValid }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Pin a region").font(.title3.weight(.semibold))

            Text(
                "The relay replicates this pack read-only from other peers. It needs the canonical "
                    + "key from the region's signed manifest — Polaris Maps shows it on the same "
                    + "region's dashboard."
            )
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            Form {
                TextField("Region id", text: $regionId, prompt: Text("north-america-us-new-york"))
                TextField(
                    "Canonical drive key",
                    text: $driveKey,
                    prompt: Text("64 hex characters")
                )
                TextField("Data version", text: $version, prompt: Text("1.0"))
                TextField("Size in bytes (optional)", text: $bytes, prompt: Text("194194043"))
            }
            .formStyle(.grouped)
            .frame(height: 170)

            if !driveKey.isEmpty && !keyIsValid {
                Text("The key must be exactly 64 hexadecimal characters.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { onCancel() }
                Button("Pin region") {
                    onPin(
                        regionId.trimmingCharacters(in: .whitespaces),
                        driveKey.lowercased(),
                        version.trimmingCharacters(in: .whitespaces).isEmpty
                            ? "unknown"
                            : version.trimmingCharacters(in: .whitespaces),
                        Int(bytes) ?? 0
                    )
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canPin)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
