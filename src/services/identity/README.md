# Identity & Security

Decentralized identity with secp256k1 keypair, Schnorr signatures, privacy consent, and encrypted storage.

## Overview

Polaris Maps uses a fully decentralized identity model — no accounts, no passwords, no central auth server. Identity is a secp256k1 keypair:

1. **Keypair generation** — `@noble/curves` secp256k1 with CSPRNG-backed random key via `schnorr.utils.randomPrivateKey()`. Private key stored exclusively in `expo-secure-store` (iOS Keychain / Android Keystore)
2. **Schnorr signing** — all user-generated data (POI edits, reviews, attestations, traffic probes) is signed with null-byte domain-separated payloads to prevent cross-context signature reuse
3. **Privacy consent** — versioned consent state for location, traffic telemetry, POI contributions, and imagery sharing. Persisted in MMKV and applied to the settings store on app launch

## Files

### Identity (`src/services/identity/`)

| File         | Description                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keypair.ts` | Generates and retrieves the user's secp256k1 keypair. Private key stored in `expo-secure-store` (never MMKV or AsyncStorage). Public key derived on load.   |
| `signing.ts` | Schnorr signature utilities — `sign()`, `verify()`, `createSigningPayload()` with null-byte (`\0`) domain separation. Uses `@noble/curves/secp256k1`.       |
| `consent.ts` | Manages versioned privacy consent state — location, traffic telemetry, POI contributions, imagery sharing. Persisted in MMKV and applied to settings store. |

### Storage (`src/services/storage/`)

| File      | Description                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mmkv.ts` | Encrypted MMKV singleton. Encryption key generated via `expo-crypto` on first launch and stored in `expo-secure-store`. Provides both async `getStorage()` and deprecated sync `storage` export. |

### Database (`src/services/database/`)

| File      | Description                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init.ts` | Opens `polaris-maps.db` via expo-sqlite and initializes the full schema (regions, map_tiles, places, route_history, reviews, peer_node, street_imagery, etc.) with WAL mode enabled. |

## Security Model

- **Private key**: never leaves `expo-secure-store` (iOS Keychain / Android Keystore)
- **All user data signed**: POI edits, reviews, attestations, traffic probes — all carry Schnorr signatures
- **Domain-separated payloads**: null-byte delimited fields prevent payload ambiguity
- **Encrypted local storage**: MMKV encrypted at rest with secure-store-backed key
- **No passwords**: identity is the keypair; no password-based auth flows exist
- **Consent-gated**: data sharing only occurs for categories the user has explicitly consented to

## Related Files

- [`src/services/poi/editService.ts`](../poi/editService.ts) — Signs POI edits with user keypair
- [`src/services/poi/attestationService.ts`](../poi/attestationService.ts) — Signs proof-of-presence attestations
- [`src/services/poi/reviewService.ts`](../poi/reviewService.ts) — Signs reviews with user keypair
- [`src/services/traffic/probeCollector.ts`](../traffic/probeCollector.ts) — Signs traffic probes
- [`src/services/traffic/nostrFallback.ts`](../traffic/nostrFallback.ts) — Verifies Schnorr signatures on incoming Nostr events
- [SECURITY.md](../../../SECURITY.md) — Full OWASP Top 10:2025 audit with findings and fixes
