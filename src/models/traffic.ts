export type CongestionLevel = 'free_flow' | 'slow' | 'congested' | 'stopped';

export interface TrafficProbe {
  geohash6: string;
  segmentId: string;
  speedKmh: number;
  bearing: number;
  timestamp: number;
  probeId: Uint8Array; // 32-byte ephemeral session ID
}

export interface AggregatedTrafficState {
  segmentId: string;
  avgSpeedKmh: number;
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
