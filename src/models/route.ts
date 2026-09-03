export type RoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'service';

export interface RoadSegment {
  segmentId: string;
  geohash6: string;
  wayId: string | null;
  roadClass: RoadClass;
  speedLimitMph: number | null;
  isOneway: boolean;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  regionId: string;
}

export type ManeuverType =
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

/** Lane guidance data from Valhalla routing */
export interface LaneGuidance {
  /** Total number of lanes at this maneuver */
  laneCount: number;
  /** Which lanes are active (0-indexed from left) */
  activeLanes: number[];
  /** Display direction arrow for each lane, left to right */
  laneDirections: LaneDirection[];
}

export type LaneDirection =
  | 'left'
  | 'slight_left'
  | 'straight'
  | 'slight_right'
  | 'right'
  | 'merge_left'
  | 'merge_right'
  | 'u_turn';

export interface ValhallaManeuver {
  type: ManeuverType;
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  beginShapeIndex: number;
  endShapeIndex: number;
  streetNames?: string[];
  verbalPreTransition: string;
  verbalPostTransition?: string;
  /** Speed limit in mph for the road at the start of this maneuver, if available. */
  speedLimitMph?: number;
  /** Lane guidance for this maneuver, if available from routing engine. */
  laneGuidance?: LaneGuidance;
}

export interface ValhallaLeg {
  maneuvers: ValhallaManeuver[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface ValhallaRoute {
  summary: {
    distanceMeters: number;
    durationSeconds: number;
    hasToll: boolean;
    hasFerry: boolean;
  };
  legs: ValhallaLeg[];
  geometry: string; // encoded polyline (precision 6)
  boundingBox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export type CostingModel = 'auto' | 'pedestrian' | 'bicycle' | 'transit';
