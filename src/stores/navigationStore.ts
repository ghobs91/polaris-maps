import { create } from 'zustand';
import type { ValhallaRoute, ValhallaManeuver, CostingModel } from '../models/route';

export type Waypoint = { lat: number; lng: number; name?: string; subtitle?: string };

interface NavigationState {
  activeRoute: ValhallaRoute | null;
  alternateRoutes: ValhallaRoute[];
  currentStepIndex: number;
  currentManeuver: ValhallaManeuver | null;
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  isNavigating: boolean;
  isRerouting: boolean;
  hasDeviated: boolean;
  costing: CostingModel;
  destination: { lat: number; lng: number; name?: string } | null;

  // Multi-destination waypoints (intermediate stops between origin & destination)
  waypoints: Waypoint[];
  currentLegIndex: number;

  // Traffic-adjusted ETA
  trafficEtaSeconds: number | null;
  freeFlowEtaSeconds: number | null;
  trafficMatchRatio: number | null;

  // Route preview (directions mode, before turn-by-turn)
  routePreview: ValhallaRoute | null;
  routePreviewAlternates: ValhallaRoute[];
  routePreviewDestination: { lat: number; lng: number; name?: string } | null;
  routePreviewWaypoints: Waypoint[];
  routePreviewCosting: CostingModel;
  routePreviewTrafficEta: number | null;

  setRoutePreview: (
    route: ValhallaRoute,
    alternates: ValhallaRoute[],
    destination: NavigationState['destination'],
    costing: CostingModel,
    waypoints?: Waypoint[],
  ) => void;
  setRoutePreviewWaypoints: (waypoints: Waypoint[]) => void;
  setRoutePreviewTrafficEta: (seconds: number | null) => void;
  clearRoutePreview: () => void;
  startNavigation: (
    route: ValhallaRoute,
    alternates: ValhallaRoute[],
    destination: NavigationState['destination'],
    costing: CostingModel,
    waypoints?: Waypoint[],
  ) => void;
  advanceLeg: () => void;
  stopNavigation: () => void;
  advanceStep: () => void;
  setCurrentStep: (index: number) => void;
  setDeviated: (deviated: boolean) => void;
  setRerouting: (rerouting: boolean) => void;
  updateEta: (etaSeconds: number, remainingMeters: number) => void;
  updateTrafficEta: (trafficEta: number, freeFlowEta: number, matchRatio: number) => void;
  replaceRoute: (route: ValhallaRoute) => void;
}

export const useNavigationStore = create<NavigationState>()((set, get) => ({
  activeRoute: null,
  alternateRoutes: [],
  currentStepIndex: 0,
  currentManeuver: null,
  etaSeconds: null,
  remainingDistanceMeters: null,
  isNavigating: false,
  isRerouting: false,
  hasDeviated: false,
  costing: 'auto',
  destination: null,
  waypoints: [],
  currentLegIndex: 0,

  trafficEtaSeconds: null,
  freeFlowEtaSeconds: null,
  trafficMatchRatio: null,

  routePreview: null,
  routePreviewAlternates: [],
  routePreviewDestination: null,
  routePreviewWaypoints: [],
  routePreviewCosting: 'auto',
  routePreviewTrafficEta: null,

  setRoutePreview: (route, alternates, destination, costing, waypoints) =>
    set({
      routePreview: route,
      routePreviewAlternates: alternates,
      routePreviewDestination: destination,
      routePreviewWaypoints: waypoints ?? [],
      routePreviewCosting: costing,
      routePreviewTrafficEta: null,
    }),

  setRoutePreviewWaypoints: (waypoints) => set({ routePreviewWaypoints: waypoints }),

  setRoutePreviewTrafficEta: (seconds) => set({ routePreviewTrafficEta: seconds }),

  clearRoutePreview: () =>
    set({
      routePreview: null,
      routePreviewAlternates: [],
      routePreviewDestination: null,
      routePreviewWaypoints: [],
      routePreviewCosting: 'auto',
      routePreviewTrafficEta: null,
    }),

  startNavigation: (route, alternates, destination, costing, waypoints) => {
    const firstManeuver = route.legs[0]?.maneuvers[0] ?? null;
    const previewTrafficEta = get().routePreviewTrafficEta;
    set({
      activeRoute: route,
      alternateRoutes: alternates,
      currentStepIndex: 0,
      currentManeuver: firstManeuver,
      etaSeconds: route.summary.durationSeconds,
      remainingDistanceMeters: route.summary.distanceMeters,
      isNavigating: true,
      isRerouting: false,
      hasDeviated: false,
      costing,
      destination,
      waypoints: waypoints ?? [],
      currentLegIndex: 0,
      // Carry over traffic ETA from preview so it's immediately available
      trafficEtaSeconds: previewTrafficEta,
      freeFlowEtaSeconds: previewTrafficEta != null ? route.summary.durationSeconds : null,
      trafficMatchRatio: previewTrafficEta != null ? 1 : null,
      // Clear preview when starting real navigation
      routePreview: null,
      routePreviewAlternates: [],
      routePreviewDestination: null,
      routePreviewWaypoints: [],
      routePreviewTrafficEta: null,
    });
  },

  advanceLeg: () => {
    const { currentLegIndex, activeRoute } = get();
    const totalLegs = activeRoute?.legs.length ?? 0;
    if (currentLegIndex + 1 < totalLegs) {
      // Move to next leg; compute the maneuver offset
      const nextLeg = currentLegIndex + 1;
      const maneuverOffset = activeRoute!.legs
        .slice(0, nextLeg)
        .reduce((sum, l) => sum + l.maneuvers.length, 0);
      set({
        currentLegIndex: nextLeg,
        currentStepIndex: maneuverOffset,
        currentManeuver: activeRoute!.legs[nextLeg]?.maneuvers[0] ?? null,
      });
    }
  },

  stopNavigation: () =>
    set({
      activeRoute: null,
      alternateRoutes: [],
      currentStepIndex: 0,
      currentManeuver: null,
      etaSeconds: null,
      remainingDistanceMeters: null,
      isNavigating: false,
      isRerouting: false,
      hasDeviated: false,
      destination: null,
      waypoints: [],
      currentLegIndex: 0,
      trafficEtaSeconds: null,
      freeFlowEtaSeconds: null,
      trafficMatchRatio: null,
    }),

  advanceStep: () => {
    const { activeRoute, currentStepIndex } = get();
    if (!activeRoute) return;
    const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < allManeuvers.length) {
      set({
        currentStepIndex: nextIndex,
        currentManeuver: allManeuvers[nextIndex],
      });
    }
  },

  setCurrentStep: (index) => {
    const { activeRoute } = get();
    if (!activeRoute) return;
    const allManeuvers = activeRoute.legs.flatMap((l) => l.maneuvers);
    if (index >= 0 && index < allManeuvers.length) {
      set({ currentStepIndex: index, currentManeuver: allManeuvers[index] });
    }
  },

  setDeviated: (hasDeviated) => set({ hasDeviated }),
  setRerouting: (isRerouting) => set({ isRerouting }),
  updateEta: (etaSeconds, remainingMeters) =>
    set({ etaSeconds, remainingDistanceMeters: remainingMeters }),
  updateTrafficEta: (trafficEta, freeFlowEta, matchRatio) =>
    set({
      trafficEtaSeconds: trafficEta,
      freeFlowEtaSeconds: freeFlowEta,
      trafficMatchRatio: matchRatio,
    }),
  replaceRoute: (route) => {
    const firstManeuver = route.legs[0]?.maneuvers[0] ?? null;
    set({
      activeRoute: route,
      currentStepIndex: 0,
      currentManeuver: firstManeuver,
      etaSeconds: route.summary.durationSeconds,
      remainingDistanceMeters: route.summary.distanceMeters,
      isRerouting: false,
      hasDeviated: false,
    });
  },
}));
