import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type {
  CarPlayLaneGuidance,
  CarPlayNavigationData,
  CarPlayStartNavigationData,
  CarPlaySearchResult,
  CarPlayTrafficRange,
} from './NativePolarisCarPlay';

export type {
  CarPlayLaneGuidance,
  CarPlayNavigationData,
  CarPlayStartNavigationData,
  CarPlaySearchResult,
  CarPlayTrafficRange,
};

const NativeModule = Platform.OS === 'ios' ? NativeModules.PolarisCarPlay : null;

export const isAvailable = NativeModule != null;

export const emitter = NativeModule ? new NativeEventEmitter(NativeModule) : null;

export function updateNavigation(data: CarPlayNavigationData): void {
  NativeModule?.updateNavigation(data);
}

export function startNavigation(data: CarPlayStartNavigationData): void {
  NativeModule?.startNavigation(data);
}

export function endNavigation(): void {
  NativeModule?.endNavigation();
}

export function updateRouteTraffic(ranges: CarPlayTrafficRange[]): void {
  (NativeModule as any)?.updateRouteTraffic?.(ranges);
}

export function showReroutingAlert(): void {
  (NativeModule as any)?.showReroutingAlert?.();
}

export function hideNavigationAlert(): void {
  (NativeModule as any)?.hideNavigationAlert?.();
}

export function pushSearchResults(results: CarPlaySearchResult[]): void {
  NativeModule?.pushSearchResults(results);
}

export function updateMapCenter(lat: number, lng: number, heading: number): void {
  NativeModule?.updateMapCenter(lat, lng, heading);
}

export async function isConnected(): Promise<boolean> {
  if (!NativeModule) return false;
  return NativeModule.isConnected();
}
