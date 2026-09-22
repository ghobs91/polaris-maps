import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface CarPlayLaneGuidance {
  laneCount: number;
  activeLanes: number[];
  laneDirections: string[];
}

export interface CarPlayNavigationData {
  isNavigating: boolean;
  instruction: string;
  /** Phone-banner text (verbalPreTransition || instruction); preferred for display. */
  displayInstruction?: string;
  maneuverType: string;
  distanceToTurnMeters: number;
  durationToTurnSeconds: number;
  etaSeconds: number;
  remainingDistanceMeters: number;
  nextInstruction?: string;
  nextManeuverType?: string;
  nextDistanceMeters?: number;
  nextDurationSeconds?: number;
  nextStreetNames?: string[];
  /** Posted speed limit in the user's preferred unit, when known. */
  speedLimitValue?: number;
  speedLimitUnit?: 'mph' | 'km/h';
  laneGuidance?: CarPlayLaneGuidance;
  /** True while the router is computing a new route after a deviation. */
  isRerouting: boolean;
  /** In-navigation mute state, so the CarPlay mute button stays in sync. */
  muted: boolean;
  /** Overall route traffic color for the ETA pill. */
  etaColor: 'default' | 'green' | 'orange' | 'red';
  /** Highway exit number/label for exit maneuvers (e.g. "91B"). */
  highwayExitLabel?: string;
  /** True when the phone's unit preference is metric (miles vs km). */
  useMetric?: boolean;
}

export interface CarPlayArrivalData {
  destinationName: string;
}

export interface CarPlayIncidentData {
  label: string;
  distanceMeters: number;
}

export interface CarPlayIncidentMarker {
  type: string;
  lat: number;
  lng: number;
}

export interface CarPlayStartNavigationData {
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  encodedPolyline: string;
  /** Phone route-preview summary ("26 min · 13.8 mi"); preferred over native formatting. */
  routeSummary?: string;
  /** True when the phone's unit preference is metric (miles vs km). */
  useMetric?: boolean;
  maneuvers: Array<{
    instruction: string;
    /** Phone-banner text (verbalPreTransition || instruction); preferred for display. */
    displayInstruction?: string;
    maneuverType: string;
    distanceMeters: number;
    durationSeconds: number;
    /** Whether this step carries lane guidance (matches update-path signature). */
    hasLaneGuidance?: boolean;
  }>;
}

export interface CarPlayTripPreviewRoute {
  encodedPolyline: string;
  /** Phone route-preview summary ("26 min · 13.8 mi"); preferred over native formatting. */
  summary: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface CarPlayTripPreviewData {
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  /** Primary route first, then alternatives in phone preview order. */
  routes: CarPlayTripPreviewRoute[];
  /** True when the phone's unit preference is metric (miles vs km). */
  useMetric?: boolean;
}

export interface CarPlaySearchResult {
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  /** Row icon kind for the pre-search list (Apple Maps style). */
  kind?: 'home' | 'work' | 'pin' | 'recent';
  /** Section the row belongs to; absent for typed-query results (flat list). */
  section?: 'pinned' | 'recent';
}

export interface CarPlayTrafficRange {
  color: string;
  from: number;
  to: number;
}

export interface Spec extends TurboModule {
  updateNavigation(data: object): void;
  startNavigation(data: object): void;
  endNavigation(): void;
  showTripPreview(data: object): void;
  hideTripPreview(): void;
  showArrival(data: object): void;
  showIncidentAlert(data: object): void;
  updateIncidents(incidents: Array<object>): void;
  updateRouteTraffic(ranges: Array<object>): void;
  showReroutingAlert(): void;
  hideNavigationAlert(): void;
  pushSearchResults(results: Array<object>): void;
  updateHomeSuggestions(items: Array<object>): void;
  updateMapCenter(lat: number, lng: number, heading: number): void;
  updateMapStyle(styleJson: string): void;
  isConnected(): Promise<boolean>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('PolarisCarPlay');
