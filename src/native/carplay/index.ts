import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type {
  CarPlayNavigationData,
  CarPlayStartNavigationData,
  CarPlaySearchResult,
} from './NativePolarisCarPlay';

export type { CarPlayNavigationData, CarPlayStartNavigationData, CarPlaySearchResult };

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
