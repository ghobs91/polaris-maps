import { create } from 'zustand';
import type { ValhallaRoute, ValhallaManeuver, CostingModel } from '../models/route';

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

  // Traffic-adjusted ETA
  trafficEtaSeconds: number | null;
  freeFlowEtaSeconds: number | null;
  trafficMatchRatio: number | null;

  // Route preview (directions mode, before turn-by-turn)
  routePreview: ValhallaRoute | null;
  routePreviewAlternates: ValhallaRoute[];
  routePreviewDestination: { lat: number; lng: number; name?: string } | null;
  routePreviewCosting: CostingModel;
  routePreviewTrafficEta: number | null;

  setRoutePreview: (
    route: ValhallaRoute,
    alternates: ValhallaRoute[],
    destination: NavigationState['destination'],
    costing: CostingModel,
  ) => void;
  setRoutePreviewTrafficEta: (seconds: number | null) => void;
  clearRoutePreview: () => void;
  startNavigation: (
    route: ValhallaRoute,
    alternates: ValhallaRoute[],
    destination: NavigationState['destination'],
    costing: CostingModel,
  ) => void;
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

  trafficEtaSeconds: null,
  freeFlowEtaSeconds: null,
  trafficMatchRatio: null,

  routePreview: null,
  routePreviewAlternates: [],
  routePreviewDestination: null,
  routePreviewCosting: 'auto',
  routePreviewTrafficEta: null,

  setRoutePreview: (route, alternates, destination, costing) =>
    set({
      routePreview: route,
      routePreviewAlternates: alternates,
      routePreviewDestination: destination,
      routePreviewCosting: costing,
      routePreviewTrafficEta: null,
    }),

  setRoutePreviewTrafficEta: (seconds) => set({ routePreviewTrafficEta: seconds }),

  clearRoutePreview: () =>
    set({
      routePreview: null,
      routePreviewAlternates: [],
      routePreviewDestination: null,
      routePreviewCosting: 'auto',
      routePreviewTrafficEta: null,
    }),

  startNavigation: (route, alternates, destination, costing) => {
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
      // Carry over traffic ETA from preview so it's immediately available
      trafficEtaSeconds: previewTrafficEta,
      freeFlowEtaSeconds: previewTrafficEta != null ? route.summary.durationSeconds : null,
      trafficMatchRatio: previewTrafficEta != null ? 1 : null,
      // Clear preview when starting real navigation
      routePreview: null,
      routePreviewAlternates: [],
      routePreviewDestination: null,
      routePreviewTrafficEta: null,
    });
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
