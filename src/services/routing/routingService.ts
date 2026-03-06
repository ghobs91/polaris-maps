import * as Valhalla from '../../native/valhalla';
import { isOnline } from '../regions/connectivityService';
import type { ValhallaRoute, CostingModel } from '../../models/route';

let initialized = false;

export async function initRouting(graphTilePath: string): Promise<void> {
  await Valhalla.initialize({ graphTilePath });
  initialized = true;
}

export async function computeRoute(
  waypoints: Array<{ lat: number; lng: number }>,
  costing: CostingModel,
  options?: {
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    avoidFerries?: boolean;
    alternates?: number;
  },
): Promise<ValhallaRoute[]> {
  if (!initialized) throw new Error('Routing not initialized. Call initRouting first.');
  return Valhalla.computeRoute(waypoints, costing, options);
}

export async function reroute(
  currentPosition: { lat: number; lng: number; bearing: number },
  destination: { lat: number; lng: number },
  costing: CostingModel,
): Promise<ValhallaRoute> {
  if (!initialized) throw new Error('Routing not initialized. Call initRouting first.');
  return Valhalla.reroute(currentPosition, destination, costing);
}

export async function updateTrafficSpeeds(speeds: Record<string, number>): Promise<void> {
  if (!initialized || !isOnline()) return;
  return Valhalla.updateTrafficSpeeds(speeds);
}

export function hasCoverage(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): boolean {
  if (!initialized) return false;
  return Valhalla.hasCoverage(bounds);
}

export async function getLoadedRegions(): Promise<
  Array<{ regionId: string; tilePath: string; sizeBytes: number }>
> {
  return Valhalla.getLoadedRegions();
}

export async function disposeRouting(): Promise<void> {
  if (!initialized) return;
  await Valhalla.dispose();
  initialized = false;
}
