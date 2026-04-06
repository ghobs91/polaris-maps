import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface CarPlayNavigationData {
  isNavigating: boolean;
  instruction: string;
  maneuverType: string;
  distanceToTurnMeters: number;
  durationToTurnSeconds: number;
  etaSeconds: number;
  remainingDistanceMeters: number;
  nextInstruction?: string;
  nextManeuverType?: string;
  nextDistanceMeters?: number;
  nextDurationSeconds?: number;
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

export interface Spec extends TurboModule {
  updateNavigation(data: object): void;
  startNavigation(data: object): void;
  endNavigation(): void;
  pushSearchResults(results: Array<object>): void;
  updateMapCenter(lat: number, lng: number, heading: number): void;
  isConnected(): Promise<boolean>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('PolarisCarPlay');
