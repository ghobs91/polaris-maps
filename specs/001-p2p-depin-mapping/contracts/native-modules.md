# Native Module Contracts

**Platform**: React Native (Expo bare workflow)  
**Bridge**: Turbo Native Modules (JSI) for Valhalla, Event bridge for nodejs-mobile

---

## Contract 1: Valhalla Routing Module

**Module name**: `PolarisValhalla`  
**Bridge type**: Turbo Native Module (C++ JSI, synchronous + async)  
**Thread**: Computation runs on a background thread; results delivered via Promise

### Interface

```typescript
interface ValhallaRoute {
  summary: {
    distance_meters: number;
    duration_seconds: number;
    has_toll: boolean;
    has_ferry: boolean;
  };
  legs: ValhallaLeg[];
  geometry: string; // Encoded polyline (precision 6)
  bounding_box: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

interface ValhallaLeg {
  maneuvers: ValhallaManeuver[];
  distance_meters: number;
  duration_seconds: number;
}

interface ValhallaManeuver {
  type: ManeuverType;
  instruction: string; // Human-readable (e.g., "Turn left onto Main St")
  distance_meters: number;
  duration_seconds: number;
  begin_shape_index: number; // Index into the geometry polyline
  end_shape_index: number;
  street_names?: string[];
  verbal_pre_transition: string; // For TTS (e.g., "In 200 meters, turn left")
  verbal_post_transition?: string;
}

type ManeuverType =
  | 'start'
  | 'destination'
  | 'turn_left'
  | 'turn_right'
  | 'sharp_left'
  | 'sharp_right'
  | 'slight_left'
  | 'slight_right'
  | 'continue'
  | 'u_turn'
  | 'merge_left'
  | 'merge_right'
  | 'enter_roundabout'
  | 'exit_roundabout'
  | 'enter_highway'
  | 'exit_highway'
  | 'ferry'
  | 'name_change';

type CostingModel = 'auto' | 'pedestrian' | 'bicycle';

interface ValhallaConfig {
  graphTilePath: string; // Absolute path to Valhalla graph tiles directory
  trafficSpeedMap?: string; // Absolute path to live traffic speed overrides (JSON)
}

interface PolarisValhallaModule {
  /**
   * Initialize Valhalla with graph tile location.
   * Must be called before any route computation.
   * Resolves when the graph is loaded and indexed.
   */
  initialize(config: ValhallaConfig): Promise<void>;

  /**
   * Compute a route between two or more points.
   * Runs on background thread — does not block JS.
   */
  computeRoute(
    waypoints: Array<{ lat: number; lng: number }>,
    costing: CostingModel,
    options?: {
      avoidTolls?: boolean;
      avoidHighways?: boolean;
      avoidFerries?: boolean;
      alternates?: number; // Number of alternate routes (0-3)
    },
  ): Promise<ValhallaRoute[]>;

  /**
   * Recompute route from current position to original destination.
   * Optimized for speed — only recomputes from deviation point.
   */
  reroute(
    currentPosition: { lat: number; lng: number; bearing: number },
    destination: { lat: number; lng: number },
    costing: CostingModel,
  ): Promise<ValhallaRoute>;

  /**
   * Update live traffic speed overrides.
   * Called when new traffic data arrives from Waku.
   * Map of segment_id → speed_kmh.
   */
  updateTrafficSpeeds(speeds: Record<string, number>): Promise<void>;

  /**
   * Check if graph tiles are loaded for a given bounding box.
   */
  hasCoverage(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): boolean;

  /**
   * Get information about loaded graph tiles.
   */
  getLoadedRegions(): Promise<
    Array<{
      regionId: string;
      tilePath: string;
      sizeBytes: number;
    }>
  >;

  /**
   * Release resources. Call on app background/termination.
   */
  dispose(): Promise<void>;
}
```

### Error Codes

| Code                  | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `NO_GRAPH`            | Graph tiles not loaded — `initialize()` not called or path invalid |
| `NO_COVERAGE`         | Route waypoints are outside loaded graph tile coverage             |
| `NO_ROUTE`            | No valid route found between waypoints                             |
| `INVALID_WAYPOINT`    | Waypoint coordinates out of range or not near a road               |
| `COMPUTATION_TIMEOUT` | Route computation exceeded 10 second timeout                       |

---

## Contract 2: Tile Server Module

**Module name**: `PolarisTileServer`  
**Bridge type**: Turbo Native Module (JSI)  
**Purpose**: Lightweight local HTTP server serving PMTiles as `{z}/{x}/{y}` tiles to MapLibre

### Interface

```typescript
interface TileServerConfig {
  port?: number; // Default: 0 (OS-assigned random port)
  cachePath: string; // Absolute path to PMTiles cache directory
}

interface TileSource {
  id: string; // Source identifier (e.g., "overture-us-ca-la")
  filePath: string; // Absolute path to PMTiles file
  arweaveGateway?: string; // Fallback gateway URL for uncached tiles
  arweaveTxId?: string; // Arweave transaction ID for remote fetching
}

interface PolarisTileServerModule {
  /**
   * Start the local tile server.
   * Returns the assigned port number.
   */
  start(config: TileServerConfig): Promise<number>;

  /**
   * Register a PMTiles file as a named tile source.
   * Tiles accessible at: http://localhost:{port}/{sourceId}/{z}/{x}/{y}.mvt
   */
  addSource(source: TileSource): Promise<void>;

  /**
   * Remove a tile source.
   */
  removeSource(sourceId: string): Promise<void>;

  /**
   * List active tile sources.
   */
  listSources(): Promise<TileSource[]>;

  /**
   * Stop the server. Call on app termination.
   */
  stop(): Promise<void>;

  /**
   * Get server URL for MapLibre style configuration.
   */
  getBaseUrl(): string; // Returns "http://localhost:{port}"
}
```

### MapLibre Tile URL Pattern

```
http://localhost:{port}/{sourceId}/{z}/{x}/{y}.mvt
```

Example: `http://localhost:8432/overture-us-ca-la/14/2825/6534.mvt`

---

## Contract 3: Hypercore Sync Module

**Module name**: Bridge via react-native-bare-kit event system  
**Bridge type**: Event-based (Bare runtime ↔ RN)  
**Purpose**: Manage Hypercore feed replication for routing graph deltas and region data

### RN → Bare Messages

```typescript
interface HypercoreCommand {
  type: 'join-feed' | 'leave-feed' | 'get-entry' | 'status' | 'list-feeds';
  feedKey?: string; // Hypercore discovery key (hex, 64 chars)
  seq?: number; // Entry sequence number (for get-entry)
  requestId: string; // Correlation ID
}
```

### Bare → RN Messages

```typescript
interface HypercoreEvent {
  type: 'entry' | 'sync-progress' | 'sync-complete' | 'error' | 'status' | 'feed-list';
  feedKey?: string;
  seq?: number;
  data?: Uint8Array; // Entry data (for entry events)
  progress?: {
    // For sync-progress
    downloaded: number;
    total: number;
    bytesDownloaded: number;
  };
  peers?: number; // Connected peers for this feed
  requestId?: string;
  error?: string;
}
```

### Feed Discovery

Feed keys for each region are published in an Arweave manifest:

```json
{
  "schema_version": 1,
  "regions": {
    "us-ca-la": {
      "routing_graph_feed": "a1b2c3d4...",
      "region_manifest_feed": "e5f6g7h8..."
    }
  },
  "updated_at": 1709654400
}
```
