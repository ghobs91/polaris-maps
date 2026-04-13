# P2P Networking & Data Sync

Decentralized data synchronization layer using Hypercore, Hyperdrive, and Gun.js with offline resilience.

## Overview

The sync layer manages all peer-to-peer data exchange beyond real-time traffic (which has its own Hyperswarm bridge). It handles:

1. **Hypercore feed sync** — region data replication between peers, with download progress tracking
2. **Hyperdrive bridge** — IPC between React Native and the nodejs-mobile sidecar for seeding/downloading file archives
3. **Offline queue** — queues outbound actions (traffic probes, POI edits, reviews, attestations) in MMKV when offline, replayed when connectivity returns
4. **Peer service** — manages the local peer node identity, resource usage, and uptime metrics in SQLite
5. **Resource management** — enforces user-configured budgets for storage, bandwidth, and battery consumption

## Architecture

```
React Native (UI thread)
    ↓
hyperdriveBridge.ts ←──→ nodejs-assets/nodejs-project/index.js
    ↓                          ↓
feedSyncService.ts        Hyperdrive seed / download / tar extract
    ↓
peerService.ts → peer_node SQLite table
    ↓
resourceManager.ts → settingsStore (limits)
    ↓
offlineQueue.ts ← MMKV (500-entry cap)
```

## Files

| File                  | Description                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feedSyncService.ts`  | Manages Hypercore feed lifecycle — join, leave, get entries for region data replication. Tracks download progress and peer counts per feed.                                       |
| `hyperdriveBridge.ts` | Bridge between React Native and the nodejs-mobile sidecar for Hyperdrive operations (seed, download, status). Uses `NativeEventEmitter` + request/response IPC pattern.           |
| `offlineQueue.ts`     | Queues outbound actions in MMKV when offline. Supports traffic probes, POI edits, reviews, and attestations. 500-entry cap with FIFO eviction. Replays when connectivity returns. |
| `peerService.ts`      | Manages local peer node identity in SQLite — joining the P2P network, recording resource limits, uptime, and data served metrics.                                                 |
| `resourceManager.ts`  | Reads user-configured resource budgets (storage MB, bandwidth Mbps, battery %/hr) from settings and computes current usage against those limits.                                  |

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
3. Hyperdrive replicates region file packs from seeding peers

## Related Files

- [`nodejs-assets/nodejs-project/`](../../../nodejs-assets/nodejs-project/) — Node.js sidecar with Hyperdrive, tar, and gunzip handlers
- [`backend/traffic-swarm.mjs`](../../../backend/traffic-swarm.mjs) — Hyperswarm Bare worklet for traffic P2P
- [`src/services/gun/init.ts`](../gun/init.ts) — Gun.js initialization with MMKV adapter
- [`src/stores/peerStore.ts`](../../stores/peerStore.ts) — Zustand store for peer state
- [`src/services/regions/`](../regions/) — Region download orchestration using Hyperdrive
