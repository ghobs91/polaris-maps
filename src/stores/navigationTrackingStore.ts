import { create } from 'zustand';
import type { StreetViewFix } from '../models/streetViewCapture';

interface NavigationTrackingState {
  /** Snapped/dead-reckoned vehicle position as [lng, lat]. */
  navPosition: [number, number] | null;
  /** Low-pass filtered course bearing in degrees. */
  navBearing: number;
  /** Live remaining distance in meters to the end of the current maneuver step. */
  distanceToTurn: number | null;
  /**
   * Clamped vehicle speed in m/s (0–55) with the position it belongs to.
   * CarPlay's native follow glide coasts on this between sparse GPS pushes
   * while the phone is locked (see `PolarisCarPlayMapView` follow ticker).
   */
  navSpeedMps: number;
  /**
   * `performance.now()` timestamp of the fix the live state was published
   * from. Consumers compare it against their own publish time to detect
   * duplicate pushes of one fix (which would restart an animation).
   */
  navFixTime: number;
  /** True while the managed background location session is running (iOS). */
  backgroundSessionActive: boolean;
  /**
   * Latest raw GPS fix, before route snapping. Street-imagery capture uses
   * this so images are placed at the camera's real position, not the
   * map-matched puck position.
   */
  rawFix: StreetViewFix | null;

  setNavPosition: (pos: [number, number] | null) => void;
  setNavBearing: (bearing: number) => void;
  setDistanceToTurn: (meters: number | null) => void;
  /**
   * Publish position, bearing, countdown, speed and fix id in one update.
   * Writing them separately lets consumers (CarPlay camera/puck) observe a new
   * position paired with the previous bearing — which makes the puck jitter.
   * `navSpeedMps` feeds CarPlay's native coast-glide between sparse locked-phone
   * fixes; `navFixTime` is a monotonic publish id so duplicate pushes of one
   * fix are skipped instead of restarting the glide.
   */
  setLiveState: (
    navPosition: [number, number] | null,
    navBearing: number,
    distanceToTurn: number | null,
    navSpeedMps?: number,
    navFixTime?: number,
  ) => void;
  setBackgroundSessionActive: (active: boolean) => void;
  setRawFix: (fix: StreetViewFix | null) => void;
}

export const useNavigationTrackingStore = create<NavigationTrackingState>()((set) => ({
  navPosition: null,
  navBearing: 0,
  distanceToTurn: null,
  navSpeedMps: 0,
  navFixTime: 0,
  backgroundSessionActive: false,
  rawFix: null,

  setNavPosition: (navPosition) => set({ navPosition }),
  setNavBearing: (navBearing) => set({ navBearing }),
  setDistanceToTurn: (distanceToTurn) => set({ distanceToTurn }),
  setLiveState: (navPosition, navBearing, distanceToTurn, navSpeedMps, navFixTime) =>
    set({
      navPosition,
      navBearing,
      distanceToTurn,
      ...(navSpeedMps !== undefined ? { navSpeedMps } : {}),
      ...(navFixTime !== undefined ? { navFixTime } : {}),
    }),
  setBackgroundSessionActive: (backgroundSessionActive) => set({ backgroundSessionActive }),
  setRawFix: (rawFix) => set({ rawFix }),
}));
