import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  reconcileStaleBackgroundSession,
  startBackgroundNavSession,
  stopBackgroundNavSession,
} from './backgroundLocationTask';
import { setTrackingRoutePreferences, stopTracking } from './trackingService';

let subscribed = false;

/**
 * Keeps the iOS background navigation session in sync with navigation state.
 *
 * Subscribes to navigationStore so the session starts/stops no matter who
 * triggers `startNavigation`/`stopNavigation` (search panel, CarPlay, …).
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
      // End the background location session and clear the shared tracking
      // pipeline when navigation ends.
      void stopBackgroundNavSession();
      stopTracking();
    }
  });
}
