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
}

export interface CarPlayStartNavigationData {
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  encodedPolyline: string;
  maneuvers: Array<{
    instruction: string;
    maneuverType: string;
    distanceMeters: number;
    durationSeconds: number;
  }>;
}

export interface CarPlaySearchResult {
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
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
  updateRouteTraffic(ranges: Array<object>): void;
  showReroutingAlert(): void;
  hideNavigationAlert(): void;
  pushSearchResults(results: Array<object>): void;
  updateMapCenter(lat: number, lng: number, heading: number): void;
  isConnected(): Promise<boolean>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('PolarisCarPlay');
