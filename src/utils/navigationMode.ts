import type { CostingModel } from '../models/route';

/** Guidance mode derived from the routing costing model. */
export type NavigationMode = 'driving' | 'walking' | 'cycling' | 'transit';

/** Which automotive-only guidance widgets a mode should display. */
export interface NavigationModeCapabilities {
  laneGuidance: boolean;
  speedLimit: boolean;
  speedometer: boolean;
}

export const NAVIGATION_MODE_CAPABILITIES: Record<NavigationMode, NavigationModeCapabilities> = {
  driving: { laneGuidance: true, speedLimit: true, speedometer: true },
  walking: { laneGuidance: false, speedLimit: false, speedometer: false },
  cycling: { laneGuidance: false, speedLimit: false, speedometer: false },
  transit: { laneGuidance: false, speedLimit: false, speedometer: false },
};

export function navigationModeForCosting(costing: CostingModel): NavigationMode {
  switch (costing) {
    case 'pedestrian':
      return 'walking';
    case 'bicycle':
      return 'cycling';
    case 'transit':
      return 'transit';
    default:
      return 'driving';
  }
}

export function navigationModeCapabilities(mode: NavigationMode): NavigationModeCapabilities {
  return NAVIGATION_MODE_CAPABILITIES[mode];
}
