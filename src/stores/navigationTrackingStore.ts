import { create } from 'zustand';

interface NavigationTrackingState {
  /** Snapped/dead-reckoned vehicle position as [lng, lat]. */
  navPosition: [number, number] | null;
  /** Low-pass filtered course bearing in degrees. */
  navBearing: number;
  /** Live remaining distance in meters to the end of the current maneuver step. */
  distanceToTurn: number | null;
  /** True while the managed background location session is running (iOS). */
  backgroundSessionActive: boolean;

  setNavPosition: (pos: [number, number] | null) => void;
  setNavBearing: (bearing: number) => void;
  setDistanceToTurn: (meters: number | null) => void;
  /**
   * Publish position, bearing and countdown in one update. Writing them
   * separately lets consumers (CarPlay camera/puck) observe a new position
   * paired with the previous bearing — which makes the puck jitter.
   */
  setLiveState: (
    navPosition: [number, number] | null,
    navBearing: number,
    distanceToTurn: number | null,
  ) => void;
  setBackgroundSessionActive: (active: boolean) => void;
}

export const useNavigationTrackingStore = create<NavigationTrackingState>()((set) => ({
  navPosition: null,
  navBearing: 0,
  distanceToTurn: null,
  backgroundSessionActive: false,

  setNavPosition: (navPosition) => set({ navPosition }),
  setNavBearing: (navBearing) => set({ navBearing }),
  setDistanceToTurn: (distanceToTurn) => set({ distanceToTurn }),
  setLiveState: (navPosition, navBearing, distanceToTurn) =>
    set({ navPosition, navBearing, distanceToTurn }),
  setBackgroundSessionActive: (backgroundSessionActive) => set({ backgroundSessionActive }),
}));
