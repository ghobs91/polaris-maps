import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { processFix } from './trackingService';
import { isForegroundInterpolationActive } from './foregroundActivity';
import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { storage } from '../storage/mmkv';

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

// MMKV flag: the user dismissed the explainer ("Not Now"). The OS leaves the
// permission status "undetermined" in that case, so without this persisted
// flag the explainer would re-show on every fresh launch.
const EXPLAINER_DISMISSED_KEY = 'backgroundNavExplainerDismissed';
// MMKV flag: we already showed the explainer AND issued the OS-level "Always"
// request. iOS commonly defers the Always grant (provisional WhenInUse plus a
// later system upgrade prompt, or the user picks "Keep Only While Using"), so
// the status can stay "undetermined" across launches. Without this flag the
// explainer would re-appear on every navigation start. After one attempt we
// stay silent; if the user enables "Always" in Settings, the next navigation
// picks it up via the granted check above.
const BACKGROUND_REQUEST_ATTEMPTED_KEY = 'backgroundNavPermissionRequested';

// Registered at module load so the task exists before any session starts.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  try {
    if (error) return;

    // Zombie-session guard: the OS relaunched us (headless) for location
    // delivery but there is no navigation to serve. Ending the OS session here
    // is what actually breaks the relaunch loop — the startup reconcile never
    // runs on a headless launch because the RN root is not mounted. Left
    // running, iOS relaunches the app for every fix until the user opens it.
    if (!useNavigationStore.getState().isNavigating) {
      await stopBackgroundNavSession();
      return;
    }

    const { locations } = data as { locations?: LocationObject[] };
    if (!locations?.length) return;

    // The managed session is the only fix source while it runs (the screen
    // skips its own watcher when backgroundSessionActive), so fixes delivered
    // while the app is foregrounded must be treated as foreground fixes —
    // otherwise haptics are suppressed on a screen-on fix. `AppState` cannot
    // decide this: with CarPlay attached it stays `active` while the phone
    // display sleeps, so gate on the screen loop actually ticking instead.
    // Reroutes run either way (single-flight, backoff-guarded in processFix).
    const background = !isForegroundInterpolationActive();

    for (const location of locations) {
      try {
        // Background mode: reroutes still run so a locked phone isn't stranded
        // off-route; haptics are skipped (phone stowed).
        processFix(location, { background });
      } catch {
        // One malformed fix must never kill the headless task.
      }
    }
  } catch {
    // Never throw out of a headless task — an uncaught error here becomes
    // a background crash (and a user-visible "crashed" dialog).
  }
});

// Shown at most once per app run: after a "Not Now" / deferred grant the OS
// status can stay "undetermined" forever, so the explainer never fires again
// and locked guidance silently stops. This points the driver at Settings.
let settingsNudgeShown = false;

/** Point the driver at Settings when "Always" is the only thing missing. */
function nudgeBackgroundSettings(): void {
  if (settingsNudgeShown) return;
  settingsNudgeShown = true;
  Alert.alert(
    'Keep guidance while locked',
    'Turn-by-turn directions pause when your phone is locked until Location access is set to "Always".',
    [
      { text: 'Not Now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}

/** Test-only: reset the once-per-run Settings nudge. */
export function resetBackgroundSettingsNudge(): void {
  settingsNudgeShown = false;
}

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
 * back to foreground-only tracking. The explainer + OS request happen at most
 * once — afterwards we stay silent until the OS reports "Always" as granted
 * (e.g. enabled in Settings), so navigation start never nags repeatedly.
 */
export async function startBackgroundNavSession(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;

  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) return false;

    const background = await Location.getBackgroundPermissionsAsync();
    let granted = background.granted;
    let askedThisCall = false;
    if (!granted && background.canAskAgain && background.status === 'undetermined') {
      // Respect a previous "Not Now" — never nag on every launch, but still
      // point the driver at Settings once per run (the OS status can stay
      // "undetermined" forever, so the explainer never returns).
      if (storage.getBoolean(EXPLAINER_DISMISSED_KEY)) {
        nudgeBackgroundSettings();
        return false;
      }
      // We already asked once (explainer + OS request) without a grant.
      if (storage.getBoolean(BACKGROUND_REQUEST_ATTEMPTED_KEY)) {
        nudgeBackgroundSettings();
        return false;
      }
      askedThisCall = true;
      const proceed = await showBackgroundPermissionExplainer();
      if (!proceed) {
        storage.set(EXPLAINER_DISMISSED_KEY, true);
        return false;
      }
      storage.set(BACKGROUND_REQUEST_ATTEMPTED_KEY, true);
      const requested = await Location.requestBackgroundPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) {
      // "While Using" (or a deferred Always) — the only fix is Settings. Don't
      // stack a second alert on top of the explainer we just showed.
      if (!askedThisCall) nudgeBackgroundSettings();
      return false;
    }

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      // AutomotiveNavigation keeps iOS delivering in-car fixes (and stops it
      // from pausing when it thinks the vehicle is stationary).
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });
    useNavigationTrackingStore.getState().setBackgroundSessionActive(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a stale OS-level location session left over from a previous run.
 *
 * `startLocationUpdatesAsync` sessions survive app kills until explicitly
 * stopped, but navigation state does not (in-memory store). Without this,
 * the OS keeps relaunching the killed app for location delivery forever —
 * each relaunch a chance to crash in the background. Call once at startup:
 * if a session is running but nothing is navigating, it is by definition
 * a zombie.
 */
export async function reconcileStaleBackgroundSession(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  try {
    if (useNavigationStore.getState().isNavigating) return;
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    // Native side unavailable — nothing to do.
  } finally {
    useNavigationTrackingStore.getState().setBackgroundSessionActive(false);
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
