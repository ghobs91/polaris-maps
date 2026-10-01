## Why

The README and service docs advertise a working peer-to-peer loop — "your phone passively contributes anonymous speed data", crowd-reported incidents, and automatic rerouting at 25%+ congestion delay. In the code, every part of that loop is inert: probe collection never starts, incident reports are signed and discarded, and the congestion rerouter has no caller and no GPS position. The documented behavior and the shipped behavior do not match.

## What Changes

- Activate consent-gated probe collection from the app lifecycle. `probeCollector` gains a coordinator that starts collection when `trafficTelemetryEnabled` is true and the app is foregrounded, stops it on background, and reacts to live consent changes via a `settingsStore` subscription. `_layout.tsx` owns the coordinator, alongside the existing `initTrafficP2P` lifecycle.
- Complete the incident exchange end-to-end. Add an incident message type to the Bare worklet, the RN bridge, and the Nostr fallback; broadcast signed incidents on report; receive, Schnorr-verify, dedupe, persist, and TTL-expire them; render incident markers on the map and warn during navigation about incidents ahead on the active route; enqueue incidents in `offlineQueue` for offline replay.
- Wire congestion reroute to reality. Feed `rerouteService` a real GPS position from `trackingService` (no second location subscription), replace the global ">3 congested segments" check with congestion-ahead-along-the-active-route evaluation, start/stop the monitor with the navigation lifecycle, add an anti-thrash guard, and forward route preferences.
- Correct documentation. Reconcile `README.md`, `src/services/traffic/README.md`, `TrafficLegend.tsx`, and any spec text so described behavior matches actual behavior once the loop is live.
- Add tests per the constitution: unit tests for probe publish, incident encode/decode/verify/TTL, and the reroute decision; contract tests for the new wire message formats.

No BREAKING changes: the new wire types are additive and old peers ignore unknown envelopes.

## Capabilities

### New Capabilities

- `p2p-traffic-probes`: consent-gated, foreground-only collection and publishing of anonymous speed probes over Hyperswarm with Nostr fallback.
- `p2p-incident-exchange`: signed incident broadcast, receive/verify/dedupe/persist/TTL, map rendering, in-navigation warnings, and offline replay.
- `congestion-reroute`: GPS-accurate, route-scoped congestion detection that reroutes with lifecycle and anti-thrash controls.

### Modified Capabilities

None. No capabilities exist in `openspec/specs/` yet, so all three are introduced as new specs.

## Impact

- **App lifecycle**: `app/_layout.tsx` (probe coordinator start/stop/consent subscription).
- **Traffic services**: `probeCollector.ts`, `incidentReportService.ts`, `rerouteService.ts`, `trafficFlowService.ts`, `hyperswarmBridge.ts`, `nostrFallback.ts`, `rpcCommands.ts`, `topicManager.ts`.
- **Worklet**: `backend/traffic-swarm.mjs` and the committed build output `backend/traffic-swarm.bundle.mjs` (rebuild via `pnpm swarm:bundle`).
- **State**: `trafficStore.ts` (incidents, collection state), `navigationStore.ts` (already exposes `isNavigating`, `activeRoute`, `costing`, `setRerouting`, `replaceRoute`), `settingsStore.ts` (consent + route preferences).
- **Navigation/GPS**: `trackingService.ts` (reuse latest position and route geometry), `app/(tabs)/navigation.tsx`, `src/components/navigation/IncidentReportPanel.tsx`, map marker layer, `src/components/map/TrafficLegend.tsx`.
- **Sync**: `src/services/sync/offlineQueue.ts` (add `incident` queue type and replay).
- **Docs**: `README.md`, `src/services/traffic/README.md`.
- **Tests**: `__tests__/unit`, `__tests__/contract`.
