export type CongestionLevel = 'free_flow' | 'slow' | 'congested' | 'stopped';

/** Mode the traffic system is currently operating in for a given geohash area. */
export type TrafficMode = 'hyperswarm' | 'nostr';

/** Minimum Hyperswarm peers before falling back to Nostr relays. */
export const MIN_PEER_THRESHOLD = 3;

export interface TrafficProbe {
  geohash6: string;
  segmentId: string;
  speedMph: number;
  bearing: number;
  timestamp: number;
  probeId: Uint8Array; // 32-byte ephemeral session ID
}

export interface AggregatedTrafficState {
  segmentId: string;
  avgSpeedMph: number;
  sampleCount: number;
  congestionLevel: CongestionLevel;
  lastUpdated: number;
}

export interface TrafficIncident {
  id: string;
  reporterPubkey: string;
  lat: number;
  lng: number;
  geohash6: string;
  type: IncidentType;
  description: string;
  reportedAt: number;
  expiresAt: number;
  signature: Uint8Array;
}

export type IncidentType =
  | 'accident'
  | 'road_closure'
  | 'hazard'
  | 'construction'
  | 'police'
  | 'other';

// --- New types for traffic flow overlay & ETA (feature 002) ---

export type TrafficSource = 'tomtom' | 'here' | 'p2p';

export interface NormalizedTrafficSegment {
  id: string;
  coordinates: [number, number][];
  currentSpeedMph: number;
  freeFlowSpeedMph: number;
  congestionRatio: number;
  confidence: number;
  source: TrafficSource;
  timestamp: number;
}

export interface ETARouteSegment {
  startCoord: [number, number];
  endCoord: [number, number];
  distanceMeters: number;
  freeFlowSpeedMph: number;
}

export interface ETAResult {
  totalSeconds: number;
  freeFlowTotalSeconds: number;
  segmentCount: number;
  matchedSegmentCount: number;
  formatted: string;
  freeFlowFormatted: string;
}

export const CONGESTION_THRESHOLDS = {
  freeFlow: 0.75,
  slow: 0.5,
  congested: 0.25,
} as const;

/** Default free-flow speeds (mph) per road class. */
export const ROAD_CLASS_SPEEDS: Record<string, number> = {
  motorway: 70,
  trunk: 55,
  primary: 45,
  secondary: 30,
  tertiary: 25,
  residential: 20,
  service: 12,
};
