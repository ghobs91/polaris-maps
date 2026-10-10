# P2P Networking & Data Sync

Decentralized data synchronization layer using Hypercore, Hyperdrive, and Gun.js with offline resilience.

## Overview

The sync layer manages all peer-to-peer data exchange beyond real-time traffic (which has its own Hyperswarm bridge). It handles:

1. **Hypercore feed sync** — region data replication between peers, with download progress tracking
2. **Hyperdrive bridge** — IPC between React Native and the **Bare Hyperdrive worklet** (`backend/hyperdrive.mjs`, `react-native-bare-kit` + `bare-rpc`) for seeding/downloading file archives and gunzip/tar extraction
3. **Offline queue** — queues outbound actions (traffic probes, POI edits, reviews, attestations) in MMKV when offline, replayed when connectivity returns
4. **Peer service** — manages the local peer node identity, resource usage, and uptime metrics in SQLite
5. **Resource management** — computes device-adaptive budgets for storage, bandwidth, and battery consumption automatically

## Architecture

```
React Native (UI thread)
    ↓
hyperdriveBridge.ts ←──→ backend/hyperdrive.mjs (Bare worklet, bare-rpc)
    ↓                          ↓
feedSyncService.ts        Hyperdrive seed / download / gunzip / tar extract
    ↓
peerService.ts → peer_node SQLite table
    ↓
resourceManager.ts → device state (adaptive limits)
    ↓
offlineQueue.ts ← MMKV (500-entry cap)
```

## Files

| File                  | Description                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feedSyncService.ts`  | Manages Hypercore feed lifecycle — join, leave, get entries for region data replication. Tracks download progress and peer counts per feed.                                                        |
| `hyperdriveBridge.ts` | Bridge between React Native and the Bare Hyperdrive worklet (`backend/hyperdrive.mjs`) for seed, download, status, gunzip, and tar extract. Uses `react-native-bare-kit`'s `Worklet` + `bare-rpc`. |
| `offlineQueue.ts`     | Queues outbound actions in MMKV when offline. Supports traffic probes, POI edits, reviews, and attestations. 500-entry cap with FIFO eviction. Replays when connectivity returns.                  |
| `peerService.ts`      | Manages local peer node identity in SQLite — joining the P2P network, recording computed resource limits, uptime, and data served metrics.                                                         |
| `resourceManager.ts`  | Computes adaptive resource budgets (storage MB, bandwidth Mbps, battery %/hr) from free disk space and network type, then checks current usage against those limits.                               |

## P2P Data Flow

### Outbound (this device → network)

1. User action creates data (edit, review, probe, attestation)
2. Data is signed with Schnorr keypair (`src/services/identity/signing.ts`)
3. If online → published immediately to Gun.js / Hyperswarm
4. If offline → queued in `offlineQueue.ts` (MMKV-persisted)
5. On reconnect → offline queue is replayed in order

### Inbound (network → this device)

1. Hyperswarm peers exchange traffic probes via the Bare worklet
2. Gun.js syncs POI edits, reviews, and reputation data with relay peers
3. Hyperdrive replicates region file packs from seeding peers. Region packs are content-addressed by a canonical key: the authoring device seeds the writable drive, every other device seeds a **read-only replica** of the same key, so all seeders share one discovery key. The canonical key is advertised by a signed region manifest (see `src/services/regions/regionManifest.ts`).
4. Region **manifest gossip** — signed manifests are discovered peer-to-peer over Gun.js (`polaris/region-manifests/<regionId>/<publisherPubkey>`): verified before merge, relayed, and persisted, so canonical-key discovery does not depend on the catalog CDN. Bundled manifests are the compiled-in root of trust.

## Related Files

- [`backend/hyperdrive.mjs`](../../../backend/hyperdrive.mjs) — Bare worklet hosting Hyperdrive + Corestore (+ gunzip/tar); exported as `hdRpcCommands.ts`
- [`backend/traffic-swarm.mjs`](../../../backend/traffic-swarm.mjs) — Hyperswarm Bare worklet for traffic P2P
- [`nodejs-assets/nodejs-project/`](../../../nodejs-assets/nodejs-project/) — legacy Node sidecar (region packs now use the Bare worklet; only attestation publish remains on `NodeChannel`)
- [`src/services/gun/init.ts`](../gun/init.ts) — Gun.js initialization with MMKV adapter
- [`src/stores/peerStore.ts`](../../stores/peerStore.ts) — Zustand store for peer state
- [`src/services/regions/`](../regions/) — Region download orchestration using Hyperdrive
