import { useNavigationStore } from '../../stores/navigationStore';
import { startBackgroundNavSession, stopBackgroundNavSession } from './backgroundLocationTask';
import { stopTracking } from './trackingService';

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

  let wasNavigating = useNavigationStore.getState().isNavigating;
  useNavigationStore.subscribe((state) => {
    if (state.isNavigating === wasNavigating) return;
    wasNavigating = state.isNavigating;
    if (state.isNavigating) {
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
