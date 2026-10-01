## Context

The repo ships three P2P pieces that are individually implemented but never connected:

- `src/services/traffic/probeCollector.ts` defines `startProbeCollector`/`stopProbeCollector`/`isCollecting` with zero call sites. `collectAndPublish` already gates on `useSettingsStore.getState().permissions.trafficTelemetryEnabled`, rotates a 32-byte probe ID hourly, and publishes via `hyperswarmBridge.publishProbe` (once `swarmPeerCount >= MIN_PEER_THRESHOLD`) or `nostrFallback.publishProbe` otherwise.
- `src/services/traffic/incidentReportService.ts` builds and Schnorr-signs a `TrafficIncident`, returns it, and drops it (`// TODO: Broadcast to Hyperswarm incident topic channel`). Nothing broadcasts, receives, renders, or expires incidents; `offlineQueue` has no `incident` type.
- `src/services/traffic/rerouteService.ts` defines `startRerouteMonitor` with zero callers. `checkForReroute` passes `{ lat: 0, lng: 0, bearing: 0 }` to `reroute()` and `hasSignificantCongestionAhead()` counts >3 congested segments globally.

Transport already exists: `backend/traffic-swarm.mjs` (Bare worklet) maintains geohash4 Hyperswarm topics and a compact JSON envelope (`t` field) for probes, conditions (`cr`/`cs`), and tiles (`tr`/`ts`); `hyperswarmBridge.ts` is the bare-rpc bridge; `nostrFallback.ts` publishes kind `20100` with Schnorr verification. `trackingService.ts` owns the single GPS subscription and already performs off-route/wrong-way rerouting; `navigationStore` exposes the reroute surface.

Consent is a persisted setting (`settingsStore.permissions.trafficTelemetryEnabled`), and the constitution requires consent before collection, on-device anonymization, and signed peer data.

## Goals / Non-Goals

**Goals:**

- Make probe collection run for real: consent-gated, foreground-only, lifecycle-driven, and reactive to consent changes.
- Make incident reporting a complete loop: sign → broadcast → receive → verify → dedupe → persist → expire → render → warn → queue offline.
- Make congestion reroute real: correct origin, route-scoped congestion, navigation lifecycle, anti-thrash, route preferences.
- Bring documentation in line with behavior.
- Cover the new pure logic and wire formats with tests.

**Non-Goals:**

- Background probe collection or background location for telemetry (explicitly foregone for battery and privacy).
- Incident reputation scoring or Gun.js reputation integration (reuse existing identity/signature verification only).
- New Hyperswarm topic namespaces, protobuf migration, or replacing compact JSON.
- Changes to `trafficAggregator`, the condition/tile channels, or the external TomTom/HERE pipeline.

## Decisions

### 1. Foreground-only probing

Probe collection runs only while the app is `active` and `trafficTelemetryEnabled` is true; it stops on `background`/`inactive`. Rationale: the constitution caps background peer battery at 5%/hour, iOS suspends sockets when backgrounded anyway, and the worklet/Bridge is already suspended by `_layout.tsx` on background. A one-shot `Location.getCurrentPositionAsync` every 5s (existing behavior) avoids holding a foreground subscription; when navigation is active, the coordinator can prefer `trackingService.getAnchor()`/last fix instead of an extra fix. Alternative considered: `expo-location` background task — rejected for battery, privacy, and consent scope.

### 2. Incidents ride the existing geohash4 topics, with a new envelope type

Incidents use the already-joined geohash4 topics and the worklet's existing `t`-tagged envelope: a new `t:'i'` incident message plus `CMD_PUBLISH_INCIDENT` / `CMD_INCOMING_INCIDENT`. Nostr fallback uses a new ephemeral kind (`20101`) with the same `g` geohash tag and an `expiration` tag set from `expiresAt`. Rationale: peers are already connected and geohash-scoped, so a new topic adds discovery cost and peer-count dilution with no benefit. Old clients ignore unknown `t` values (the worklet only falls through to legacy probe decoding for un-tagged messages), so the change is backward-compatible.

### 3. Incident authenticity, abuse, and TTL

- **Identity**: reuse the existing secp256k1/Nostr keypair. The incident signature is over a canonical payload (`id`, `reporterPubkey`, lat, lng, geohash6, type, description, `reportedAt`) using the existing `createSigningPayload`/`sign`, verified with `verify`. Schnorr failure drops the incident silently.
- **Dedupe**: key on incident `id` (`pubkeyPrefix-timestamp36`); first valid copy wins, subsequent copies are ignored.
- **Abuse**: per-pubkey rate limit in the receiver (e.g. N incidents per window), description length cap (200 chars, matching the UI), type allow-list, and coordinate sanity (geohash6 matches reported lat/lng). Reputation weighting is deferred — no reputation source is wired into this path.
- **TTL**: `expiresAt` is authoritative. Receivers drop expired incidents on ingest and run a periodic sweep; Nostr uses the `expiration` tag so relays also discard them. Default 2h, matching `incidentReportService`.

### 4. Battery and driver-distraction budget

- Probes: 5s publish interval only while foregrounded; collection state mirrored into `trafficStore.isCollectingProbes`.
- Incidents: no polling — push-driven ingest, plus a low-frequency (e.g. 60s) TTL sweep aligned with the existing periodic traffic refresh.
- Warnings: at most one non-blocking warning per incident per trip, fired only when the incident is within a distance threshold ahead on the active route polyline; rendered as a banner/toast with optional voice, never a modal, plus a single haptic. This keeps eyes on the road.

### 5. Reroute decision is route-scoped, not global

Replace `hasSignificantCongestionAhead()` with a pure function that takes the active route polyline, a `[lng, lat]` origin, and the current traffic states, walks forward along the route within a look-ahead window, and returns the worst congestion/delay impact for segments ahead of the origin. It reuses `trackingService`'s latest position (`getAnchor()`/last processed fix) and decoded route coords (`getRouteCoords()`) instead of adding a second GPS subscription. The delay test remains "new route must beat the current route by more than `SIGNIFICANT_DELAY_FACTOR`" and is combined with a cooldown so a reroute cannot fire more than once per window.

### 6. Lifecycle wiring

A dedicated coordinator module subscribes to `AppState`, `settingsStore`, and `navigationStore`: it starts/stops probe collection on consent + foreground changes, and starts/stops the reroute monitor on `isNavigating`. This keeps `_layout.tsx` thin and the logic unit-testable, rather than embedding subscriptions in the root component.

## Risks / Trade-offs

- **Backward compatibility of a new `t` envelope** → Unknown envelope handling currently falls through to legacy probe decode, which returns null for an incident payload; verify explicitly and add a contract test asserting no probe is emitted for an incident message.
- **New worklet code requires rebundling and a native rebuild** → Rebuild with `pnpm swarm:bundle`, commit the artifact, and note that devices need the updated bundle; the RN side must tolerate a missing/old bundle (bridge already degrades when `trafficBundle` is absent).
- **False or stale incidents** → TTL, dedupe, rate limiting, and a user-facing dismiss/report path; do not let incidents override the routing engine without the delay threshold.
- **Consent race at startup** → The coordinator reads consent at start and subscribes to changes; a toggle during collection starts/stops immediately. Contract: no collection before consent resolves.
- **Driver distraction** → Strict one-warning-per-incident-per-trip and banner-only UI.
- **GPS origin off by a fix** → Use the latest `trackingService` position and only reroute when the origin is on/near the route; otherwise defer (the existing off-route flow handles true deviations).

## Migration Plan

Additive and reversible. Deploy order: (1) worklet incident envelope + bridge + `rpcCommands`, (2) incident store/persistence/render, (3) probe coordinator, (4) reroute rewrite, (5) docs. No persisted-data migration is required; new incident storage is a new key and new MMKV/SQLite rows are ignored by older builds. Rollback: revert the coordinator wiring first (probes/reroute stop cleanly), then the incident additions; the wire types are ignored by older peers, so mixed-version networks stay functional. Rebuild and commit `traffic-swarm.bundle.mjs` as part of any worklet rollback.

## Open Questions

- Should incidents contribute to the traffic-adjusted ETA, or remain advisory-only warnings?
- What is the correct per-pubkey incident rate limit, and should dismissed/false incidents lower a locally cached trust score?
- Should incidents persist across app restarts/region changes, and for how long in offline storage?
- What warning distance ahead on the route is right per road class and speed band?
- Should a new incident from a peer preempt an in-flight congestion reroute, or wait for the next monitor tick?
- Do we cap the number of simultaneously rendered incident markers at low zoom, and how should clustering work?
