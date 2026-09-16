## 1. Incident transport (worklet + bridge + Nostr)

- [x] 1.1 Add `CMD_PUBLISH_INCIDENT` and `CMD_INCOMING_INCIDENT` command IDs to `backend/traffic-swarm.mjs` and `src/services/traffic/rpcCommands.ts`
- [x] 1.2 Implement the `t:'i'` incident envelope in `backend/traffic-swarm.mjs`: parse, forward to RN via RPC, and broadcast to joined peers
- [x] 1.3 Handle the incident envelope before legacy probe decoding so it never produces a probe
- [x] 1.4 Add `publishIncident` and `onIncident` to `src/services/traffic/hyperswarmBridge.ts` with typed handlers
- [x] 1.5 Add incident publish/subscribe to `src/services/traffic/nostrFallback.ts` using a distinct ephemeral kind, `g` tag, and `expiration` tag
- [x] 1.6 Add a pure incident wire encoder/decoder (id, pubkey, coords, geohash6, type, description, reportedAt, expiresAt, signature) shared by both transports
- [x] 1.7 Rebuild `backend/traffic-swarm.bundle.mjs` with `pnpm swarm:bundle` and commit the artifact

## 2. Incident exchange service

- [x] 2.1 Make `submitIncidentReport` return the signed incident and broadcast it via Hyperswarm when peer threshold is met, else Nostr
- [x] 2.2 Add incident receive handling: Schnorr-verify, reject expired, dedupe by id, then persist
- [x] 2.3 Add incident persistence and a TTL sweep that removes expired incidents
- [x] 2.4 Add per-pubkey rate limiting and field validation (type allow-list, description length, geohash6/coordinate consistency)
- [x] 2.5 Extend `src/services/sync/offlineQueue.ts` with the `incident` queue type and replay on flush
- [x] 2.6 Enqueue the incident when no transport is available at submit time

## 3. Incident UI

- [x] 3.1 Add an incidents slice to `src/stores/trafficStore.ts` with add/remove/expire selectors
- [x] 3.2 Render accepted incident markers on the map using `INCIDENT_TYPE_ICONS` and labels
- [x] 3.3 Remove markers when incidents expire
- [x] 3.4 Add a route-scoped "incidents ahead" selector for the active navigation route
- [x] 3.5 Show a single non-blocking warning per incident per trip during navigation (banner and optional voice, no modal)
- [x] 3.6 Update `IncidentReportPanel` to surface transport failure and rely on the queue instead of silent failure

## 4. Probe collection activation

- [x] 4.1 Create a probe coordinator that starts/stops collection based on `trafficTelemetryEnabled` and `AppState`
- [x] 4.2 Subscribe the coordinator to `settingsStore` so consent changes take effect immediately
- [x] 4.3 Wire the coordinator into `app/_layout.tsx` next to the existing `initTrafficP2P` lifecycle
- [x] 4.4 Mirror collection state into `trafficStore.isCollectingProbes`
- [x] 4.5 Ensure collection is not started before consent resolves

## 5. Congestion reroute wiring

- [x] 5.1 Expose the latest tracking position and decoded route coords from `trackingService` for the rerouter
- [x] 5.2 Replace `hasSignificantCongestionAhead` with a pure congestion-ahead-along-route evaluator
- [x] 5.3 Use the tracking position and bearing as the reroute origin instead of the zeroed placeholder
- [x] 5.4 Return early/defer when no tracking fix is available
- [x] 5.5 Start/stop the reroute monitor with the navigation lifecycle
- [x] 5.6 Add a reroute cooldown and preserve the significant-delay improvement check
- [x] 5.7 Forward `settingsStore.routePreferences` into the reroute request
- [x] 5.8 Set/clear `navigationStore.isRerouting` around the reroute

## 6. Documentation

- [x] 6.1 Correct README.md statements about probe contribution, incident reporting, and automatic rerouting to match actual behavior
- [x] 6.2 Correct `src/services/traffic/README.md` (constants, reroute description, incident channel)
- [x] 6.3 Correct `src/components/map/TrafficLegend.tsx` source/reroute captions

## 7. Tests

- [x] 7.1 Unit tests for probe publish transport selection and consent gating
- [x] 7.2 Unit tests for incident encode/decode round-trip, signature verification, dedupe, and TTL expiry
- [x] 7.3 Unit tests for the congestion-ahead-along-route decision and anti-thrash guard
- [x] 7.4 Contract tests for the incident wire format and worklet/bridge command IDs, including the "incident is not a probe" case
- [x] 7.5 Integration test for the report → broadcast → receive → render loop

## 8. Verification

- [x] 8.1 Run `pnpm typecheck`
- [x] 8.2 Run `pnpm lint` and `pnpm format:check`
- [x] 8.3 Run the relevant Jest suites and report actual results
- [x] 8.4 Run `openspec validate activate-p2p-core`
