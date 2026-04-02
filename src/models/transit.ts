// ── Transit mode types ──────────────────────────────────────────────

export type TransitMode =
  | 'BUS'
  | 'RAIL'
  | 'SUBWAY'
  | 'TRAM'
  | 'FERRY'
  | 'CABLE_CAR'
  | 'GONDOLA'
  | 'FUNICULAR';

export type LegMode = TransitMode | 'WALK' | 'BICYCLE';

// ── MobilityData Feed Catalog types ─────────────────────────────────

export interface TransitFeedLocation {
  country_code: string;
  country: string;
  subdivision_name?: string;
  municipality?: string;
}

export interface TransitFeedBoundingBox {
  minimum_latitude: number;
  maximum_latitude: number;
  minimum_longitude: number;
  maximum_longitude: number;
}

export interface TransitFeedLatestDataset {
  id: string;
  hosted_url?: string;
  bounding_box?: TransitFeedBoundingBox;
  downloaded_at?: string;
}

export interface TransitFeed {
  id: string;
  data_type: 'gtfs' | 'gtfs_rt' | 'gbfs';
  status: 'active' | 'deprecated' | 'inactive' | 'development' | 'future';
  provider: string;
  feed_name?: string;
  locations: TransitFeedLocation[];
  latest_dataset?: TransitFeedLatestDataset;
  bounding_box?: TransitFeedBoundingBox;
}

export interface TransitRealtimeFeed {
  id: string;
  data_type: 'gtfs_rt';
  provider: string;
  entity_types: Array<'vp' | 'tu' | 'sa'>;
  feed_references: string[];
  locations: TransitFeedLocation[];
}

// ── OpenTripPlanner types (GTFS GraphQL API) ────────────────────────

export interface OtpPlace {
  name: string;
  lat: number;
  lon: number;
  departure?: {
    scheduledTime: string;
    estimated?: { time: string; delay: number };
  };
  arrival?: {
    scheduledTime: string;
    estimated?: { time: string; delay: number };
  };
  stop?: {
    gtfsId: string;
    name: string;
    code?: string;
    platformCode?: string;
  };
}

export interface OtpRoute {
  gtfsId: string;
  shortName?: string;
  longName?: string;
  color?: string;
  textColor?: string;
  mode: TransitMode;
  agency?: {
    gtfsId: string;
    name: string;
  };
}

export interface OtpLeg {
  mode: LegMode;
  from: OtpPlace;
  to: OtpPlace;
  startTime: number;
  endTime: number;
  duration: number;
  distance: number;
  route?: OtpRoute;
  tripId?: string;
  headsign?: string;
  intermediateStops?: Array<{
    name: string;
    lat: number;
    lon: number;
    arrival?: { scheduledTime: string; estimated?: { time: string; delay: number } };
    departure?: { scheduledTime: string; estimated?: { time: string; delay: number } };
  }>;
  legGeometry: {
    points: string; // encoded polyline (precision 5, OTP standard)
  };
  realTime?: boolean;
  alerts?: Array<{
    alertHeaderText?: string;
    alertDescriptionText?: string;
    alertUrl?: string;
  }>;
}

export interface OtpItinerary {
  start: string;
  end: string;
  duration: number;
  walkDistance: number;
  waitingTime: number;
  transfers: number;
  legs: OtpLeg[];
}

export interface OtpStop {
  gtfsId: string;
  name: string;
  code?: string;
  lat: number;
  lon: number;
  routes: OtpRoute[];
  vehicleMode?: TransitMode;
}

// ── Nearby departures ───────────────────────────────────────────────

export interface StopDeparture {
  scheduledTime: string;
  realtimeTime?: string;
  delay?: number;
  headsign: string;
  route: {
    shortName?: string;
    longName?: string;
    color?: string;
    mode: TransitMode;
  };
  tripId: string;
}

export interface NearbyStop {
  stop: OtpStop;
  distanceMeters: number;
  departures: StopDeparture[];
}

// ── Transit route line (for map rendering) ──────────────────────────

export interface TransitRouteLineStop {
  name: string;
  lat: number;
  lon: number;
  /** GTFS stop_id or OSM node id (e.g. "gtfs:102" or "osm:node:123") */
  stopId: string;
}

export interface TransitRouteLine {
  id: string;
  ref?: string;
  name?: string;
  operator?: string;
  color?: string;
  mode: TransitMode;
  /** Array of line segments — each segment is [lng, lat][] */
  geometry: [number, number][][];
  stops: TransitRouteLineStop[];
}

// ── Selected transit stop (for departure card) ──────────────────────

export interface SelectedTransitStop {
  name: string;
  lat: number;
  lon: number;
  /** Route badges serving this stop */
  routes: Array<{
    ref?: string;
    name?: string;
    color?: string;
    mode: TransitMode;
  }>;
}
