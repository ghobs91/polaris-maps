import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { hasCompletedConsent } from '../identity/consent';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { isCollecting, startProbeCollector, stopProbeCollector } from './probeCollector';

let appStateSubscription: NativeEventSubscription | null = null;
let settingsUnsubscribe: (() => void) | null = null;
let currentAppState: AppStateStatus = AppState.currentState;

/**
 * Probe contribution requires completed privacy consent AND the granular
 * traffic-telemetry permission, and only runs while the app is foregrounded
 * so background battery use stays within the constitution's budget.
 */
export function isProbeCollectionAllowed(): boolean {
  return (
    currentAppState === 'active' &&
    hasCompletedConsent() &&
    useSettingsStore.getState().permissions.trafficTelemetryEnabled
  );
}

function syncProbeCollection(): void {
  if (isProbeCollectionAllowed()) {
    startProbeCollector();
  } else {
    stopProbeCollector();
  }

  const collecting = isCollecting();
  if (useTrafficStore.getState().isCollectingProbes !== collecting) {
    useTrafficStore.getState().setCollecting(collecting);
  }
}

/**
 * Start watching app state and consent so probe collection is always in the
 * state the user has authorised. Safe to call more than once.
 */
export function initProbeCollection(): void {
  if (appStateSubscription || settingsUnsubscribe) return;

  currentAppState = AppState.currentState;
  appStateSubscription = AppState.addEventListener('change', (next) => {
    currentAppState = next;
    syncProbeCollection();
  });
  settingsUnsubscribe = useSettingsStore.subscribe(syncProbeCollection);

  syncProbeCollection();
}

/** Stop collection and tear down the lifecycle listeners. */
export function disposeProbeCollection(): void {
  appStateSubscription?.remove();
  settingsUnsubscribe?.();
  appStateSubscription = null;
  settingsUnsubscribe = null;

  stopProbeCollector();
  if (useTrafficStore.getState().isCollectingProbes) {
    useTrafficStore.getState().setCollecting(false);
  }
}
