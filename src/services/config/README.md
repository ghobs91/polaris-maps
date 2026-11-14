# Remote Config (Signed Kill Switches)

A single static JSON document — signed with the same secp256k1 publisher key as
region manifests — that can disable a third-party-dependent feature without an
App Store release. It contains no user data and no identifiers, and Polaris
does not run a user-data backend.

## Contract

- **Source**: `EXPO_PUBLIC_REMOTE_CONFIG_URL`, defaulting to
  `https://app.polarismaps.app/config.json` (the project's existing static site).
- **Verification**: `parseRemoteConfig` requires a trusted publisher
  (`TRUSTED_REGION_PUBLISHERS`) and a valid Schnorr signature over a canonical
  payload. Unsigned, tampered, or untrusted documents are ignored.
- **Cache**: the last verified document is stored in encrypted MMKV and
  re-verified on hydration. A failed refresh keeps the last good flags.
- **Defaults**: everything enabled. A missing config never disables a feature;
  only a verified document can.
- **No targeting**: flags are global, not per-user, per-region, or per-device.

## Flags

| Flag              | Gates                                                         |
| ----------------- | ------------------------------------------------------------- |
| `trafficP2P`      | Hyperswarm/Nostr mesh, probe contribution, incident exchange  |
| `regionDownloads` | Offline region pack downloads (OpenFreeMap + GitHub Releases) |
| `streetView`      | Online street-level panorama lookups                          |
| `overturePlaces`  | Overture PMTiles viewport/search enrichment                   |
| `tomtomBridge`    | TomTom cold-start bridge (flow grid, tiles, route ETA)        |

Missing flag keys default to `true`, so adding a new flag cannot silently
disable it in an old document.

### Flags added after signing

The signature covers the original five flags only. Adding a field to the signed
payload would invalidate every config already published, so later flags are read
from the same `flags` object but are **not** signature-covered:

| Flag                | Default | Gates                                                                       |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `overpassQuery`     | on      | Public Overpass fallback for areas with no pack                             |
| `nominatimFallback` | **off** | Nominatim address lookup — OSMF caps the whole app at 1 req/s               |
| `transitousPlan`    | **off** | Transitous `/plan` — published ceiling is 720 calls/24h for the whole app   |
| `photonFallback`    | on      | Photon text-search fallback — no published quota, so it is rationed instead |
| `basemapTilesUrl`   | unset   | Alternative OpenMapTiles tilejson for the vector basemap (https only)       |

`photonFallback` and `basemapTilesUrl` are bounded in code rather than by the
document: a per-device daily allowance in `search/photonFallbackBudget`, and
https-only, vector-source-only application in `map/basemapSource`.

## Where it is published

`REMOTE_CONFIG_URL` derives from `REGION_DATA_REPO` and `REGION_DATA_TAG`
(`map-data-latest`) in `constants/config`, so the kill-switch document lives on
the same release as the packs and the catalog. See
[`docs/pack-publishing.md`](../../../docs/pack-publishing.md).

## Signing and publishing

```bash
# config.json: { "version": 1, "issuedAt": "2026-11-09T00:00:00.000Z", "flags": { "streetView": false } }
POLARIS_CONFIG_PRIVATE_KEY=<64-hex> \
  node scripts/sign-remote-config.mjs config.json > signed-config.json
```

Upload `signed-config.json` to the configured URL. The app checks once per
session (3 s timeout) and applies changes to new calls immediately; the traffic
mesh is started or stopped by `app/_layout.tsx` through
`subscribeRemoteConfig`.

Payload order is fixed: `version`, `issuedAt`, then the four flags in
`FLAG_ORDER` as `1`/`0`, then `publisherPubkey`. The
`remoteConfigSignature` unit test runs the signer and verifies its output, so
the app and script cannot drift.
