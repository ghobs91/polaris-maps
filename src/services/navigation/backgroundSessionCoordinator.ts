import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  reconcileStaleBackgroundSession,
  startBackgroundNavSession,
  stopBackgroundNavSession,
} from './backgroundLocationTask';
import { setTrackingRoutePreferences, startTracking, stopTracking } from './trackingService';

let subscribed = false;
/** Geometry of the route the shared tracking pipeline is currently following. */
let trackedGeometry: string | null = null;

/**
 * Keeps the iOS background navigation session AND the shared tracking pipeline
 * in sync with navigation state.
 *
 * Subscribes to navigationStore so tracking starts/stops no matter who triggers
 * `startNavigation`/`stopNavigation` (search panel, CarPlay, …) and no matter
 * whether the navigation screen is mounted. The screen's own effect previously
 * owned `startTracking`, but Expo Router bottom tabs are lazy-mounted: a trip
 * started from CarPlay (or any headless path) never mounted that screen, so
 * every fix was dropped and the head unit map froze at the route start.
 *
 * Lives outside the store to keep it free of native-module imports (which
 * break non-native test environments).
 *
 * Call once during app startup (root layout).
 */
export function initNavigationBackgroundSession(): void {
  if (subscribed) return;
  subscribed = true;

  // Clear a zombie OS-level location session from a previous run (e.g. the
  // app was killed mid-navigation). Without this the OS relaunches the app
  // in the background for location delivery indefinitely.
  void reconcileStaleBackgroundSession();

  let wasNavigating = useNavigationStore.getState().isNavigating;
  useNavigationStore.subscribe((state) => {
    // Start (or re-start on a route replacement) the shared tracking pipeline
    // as soon as a trip is active, independent of any UI mount.
    if (state.isNavigating && state.activeRoute) {
      if (state.activeRoute.geometry !== trackedGeometry) {
        trackedGeometry = state.activeRoute.geometry;
        setTrackingRoutePreferences(useSettingsStore.getState().routePreferences);
        startTracking(state.activeRoute);
      }
    } else if (trackedGeometry !== null) {
      // Trip ended or its route was cleared — stop the shared pipeline.
      trackedGeometry = null;
      stopTracking();
    }

    if (state.isNavigating === wasNavigating) return;
    wasNavigating = state.isNavigating;
    if (state.isNavigating) {
      // Make the user's avoidance prefs available to the shared tracking
      // pipeline (reroutes), including headless background delivery where
      // the navigation screen effect never runs.
      setTrackingRoutePreferences(useSettingsStore.getState().routePreferences);
      // Fire and forget — on denial/failure navigation continues
      // foreground-only via the screen's watcher.
      void startBackgroundNavSession();
    } else {
      // End the background location session when navigation ends.
      void stopBackgroundNavSession();
    }
  });
}
