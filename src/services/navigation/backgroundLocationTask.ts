import { Platform } from 'react-native';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { processFix } from './trackingService';
import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';

/**
 * Headless background location task + managed session lifecycle for
 * turn-by-turn navigation on iOS.
 *
 * The task forwards fixes into the shared tracking pipeline exactly like the
 * foreground watcher does, so guidance continues uninterrupted while the app
 * is backgrounded or the screen is locked. The session runs only while
 * navigation is active: started from `startNavigation`, stopped from
 * `stopNavigation` (see navigationStore).
 */

export const BACKGROUND_LOCATION_TASK = 'polaris-background-navigation';

// Registered at module load so the task exists before any session starts.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;

  // Zombie-session guard: if the OS relaunches the app headlessly but
  // navigation is not active, exit without processing.
  if (!useNavigationStore.getState().isNavigating) return;

  const { locations } = data as { locations?: LocationObject[] };
  if (!locations?.length) return;

  for (const location of locations) {
    processFix(location);
  }
});

/** Resolve after showing the pre-prompt explainer. False if dismissed. */
function showBackgroundPermissionExplainer(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Background Navigation',
      'To keep turn-by-turn directions running while the app is closed or your screen is locked, Polaris Maps needs location access "Always".',
      [
        { text: 'Not Now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
    );
  });
}

/**
 * Check/request background ("Always") location permission and start the
 * managed background location session. Returns true when the session is
 * running (the screen's foreground watcher then hands over to the task).
 *
 * Graceful degradation: returns false on denial/failure and navigation falls
 * back to foreground-only tracking. Never re-prompts a previously denied user.
 */
export async function startBackgroundNavSession(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;

  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) return false;

    const background = await Location.getBackgroundPermissionsAsync();
    let granted = background.granted;
    if (!granted && background.canAskAgain && background.status === 'undetermined') {
      const proceed = await showBackgroundPermissionExplainer();
      if (!proceed) return false;
      const requested = await Location.requestBackgroundPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return false;

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });
    useNavigationTrackingStore.getState().setBackgroundSessionActive(true);
    return true;
  } catch {
    return false;
  }
}

/** Stop the managed background session. Safe to call when not running. */
export async function stopBackgroundNavSession(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    // Session already gone or native side unavailable — nothing to do.
  } finally {
    useNavigationTrackingStore.getState().setBackgroundSessionActive(false);
  }
}
