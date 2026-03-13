# Quickstart: Real-Time Traffic Flow Overlay with Dynamic ETA

**Feature**: 002-traffic-flow-eta
**Branch**: `002-traffic-flow-eta`

## Prerequisites

1. **API Keys**: Obtain free-tier API keys from:
   - [TomTom Developer Portal](https://developer.tomtom.com/) — Traffic Flow API
   - [HERE Developer Portal](https://developer.here.com/) — Traffic Flow v7 API

2. **Environment file**: Create `.env` at the project root:

   ```
   TOMTOM_API_KEY=your_tomtom_key_here
   HERE_API_KEY=your_here_api_key_here
   ```

3. **Dependencies**: All required dependencies are already in `package.json`. No new packages needed.

## Key Files

| File                                         | Purpose                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `src/models/traffic.ts`                      | `NormalizedTrafficSegment` and `ETARouteSegment` types |
| `src/services/traffic/tomtomFetcher.ts`      | TomTom API fetcher + normalizer                        |
| `src/services/traffic/hereFetcher.ts`        | HERE API fetcher + normalizer                          |
| `src/services/traffic/trafficMerger.ts`      | Multi-source merge with confidence weighting           |
| `src/services/traffic/trafficFlowService.ts` | Orchestrator: fetch → normalize → merge → store        |
| `src/utils/etaCalculator.ts`                 | Pure `calculateTrafficETA()` function                  |
| `src/components/map/TrafficOverlay.tsx`      | MapLibre LineLayer traffic rendering                   |
| `src/components/map/TrafficLegend.tsx`       | Legend UI component                                    |
| `src/components/navigation/EtaDisplay.tsx`   | Updated ETA display with traffic-adjusted time         |

## Architecture Overview

```
┌─────────────────────────────────────┐
│           trafficFlowService        │  ← orchestrator
│  (debounced viewport change hook)   │
└──────┬───────────────┬──────────────┘
       │               │
       ▼               ▼
┌──────────────┐ ┌──────────────┐
│ tomtomFetcher│ │ hereFetcher  │  ← parallel fetch + normalize
└──────┬───────┘ └──────┬───────┘
       │               │
       ▼               ▼
┌──────────────────────────────────────┐
│           trafficMerger              │  ← merge + P2P integration
│  (confidence-weighted averaging)     │
└──────────────────┬───────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │ trafficStore │  ← normalizedSegments
            └──────┬───────┘
                   │
       ┌───────────┼────────────┐
       ▼                        ▼
┌──────────────┐      ┌──────────────────┐
│TrafficOverlay│      │ calculateTrafficETA │
│  (LineLayer) │      │  (pure function)    │
└──────────────┘      └────────┬────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  EtaDisplay  │
                        └──────────────┘
```

## Running Tests

```bash
# Unit tests (ETA calculator, normalizers, merger)
pnpm test -- --testPathPattern="etaCalculator|tomtomFetcher|hereFetcher|trafficMerger"

# Integration tests (overlay rendering)
pnpm test:integration -- --testPathPattern="trafficOverlay"

# Benchmark (ETA calculation with large segment arrays)
pnpm test:benchmark -- --testPathPattern="etaCalculator"

# All tests
pnpm test
```

## Development Flow

1. **Start with types**: Add `NormalizedTrafficSegment` and `ETARouteSegment` to `src/models/traffic.ts`
2. **Build ETA calculator**: Implement and test `calculateTrafficETA()` in isolation — no UI or API needed
3. **Build API fetchers**: Implement TomTom and HERE fetchers with fixture-based tests
4. **Build merger**: Implement multi-source merge with confidence weighting
5. **Build orchestrator**: Wire fetchers + merger into `trafficFlowService` with debouncing
6. **Update overlay**: Replace placeholder `TrafficOverlay` with `LineLayer` rendering
7. **Add legend**: Create `TrafficLegend` component
8. **Wire ETA display**: Connect traffic-adjusted ETA to `EtaDisplay` component
9. **Integration**: Hook everything up in the navigation tab

## Congestion Color Mapping

| Band      | Ratio Range | Color    | Hex       |
| --------- | ----------- | -------- | --------- |
| Free Flow | ≥ 0.75      | Green    | `#34C759` |
| Slow      | 0.50 – 0.74 | Orange   | `#FF9500` |
| Congested | 0.25 – 0.49 | Red      | `#FF3B30` |
| Stopped   | < 0.25      | Dark Red | `#991B1B` |
