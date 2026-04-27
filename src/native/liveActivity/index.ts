import { NativeModules, Platform } from 'react-native';
import type { ManeuverType } from '../../models/route';

interface PolarisLiveActivityNative {
  isSupported(): Promise<boolean>;
  startActivity(
    etaSeconds: number,
    remainingDistanceMeters: number,
    maneuverType: string,
    maneuverInstruction: string,
    streetName: string | null,
    destinationName: string,
    transportMode: string,
  ): void;
  updateActivity(
    etaSeconds: number,
    remainingDistanceMeters: number,
    maneuverType: string,
    maneuverInstruction: string,
    streetName: string | null,
  ): void;
  endActivity(): void;
}

const NativeModule: PolarisLiveActivityNative | null =
  Platform.OS === 'ios' ? NativeModules.PolarisLiveActivity : null;

export const isAvailable = NativeModule != null;

export async function isSupported(): Promise<boolean> {
  if (!NativeModule) return false;
  try {
    return await NativeModule.isSupported();
  } catch {
    return false;
  }
}

export function startActivity(params: {
  etaSeconds: number;
  remainingDistanceMeters: number;
  maneuverType: ManeuverType;
  maneuverInstruction: string;
  streetName?: string;
  destinationName: string;
  transportMode: string;
}): void {
  NativeModule?.startActivity(
    params.etaSeconds,
    params.remainingDistanceMeters,
    params.maneuverType,
    params.maneuverInstruction,
    params.streetName ?? null,
    params.destinationName,
    params.transportMode,
  );
}

export function updateActivity(params: {
  etaSeconds: number;
  remainingDistanceMeters: number;
  maneuverType: ManeuverType;
  maneuverInstruction: string;
  streetName?: string;
}): void {
  NativeModule?.updateActivity(
    params.etaSeconds,
    params.remainingDistanceMeters,
    params.maneuverType,
    params.maneuverInstruction,
    params.streetName ?? null,
  );
}

export function endActivity(): void {
  NativeModule?.endActivity();
}
