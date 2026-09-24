/**
 * Headless arrival + waypoint-leg progression.
 *
 * The navigation screen used to own arrival detection, so a trip started from
 * CarPlay on a cold app (the Navigate tab never mounted) never declared
 * arrival, never showed the arrival card, and never auto-ended. This
 * coordinator subscribes to the shared stores so the behavior is identical on
 * every surface. The screen keeps only the presentation (summary + haptics)
 * and reacts to `hasArrived` / leg-index changes.
 *
 * Spoken arrival/reroute/advance prompts are handled separately by
 * `navigationVoice`; this module only advances navigation state.
 */

import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ArrivalDetector, distanceToTargetMeters, targetForLeg } from './arrivalService';

let initialized = false;
let unsubscribe: (() => void) | null = null;
const waypointDetector = new ArrivalDetector();
const destinationDetector = new ArrivalDetector();
let autoEndTimer: ReturnType<typeof setTimeout> | null = null;
let arrivedAt: number | null = null;
let wasNavigating = false;

/** Grace period before an arrived trip auto-ends (lets the card be seen). */
const AUTO_END_DELAY_MS = 8000;

function clearAutoEnd(): void {
  if (autoEndTimer) {
    clearTimeout(autoEndTimer);
    autoEndTimer = null;
  }
  arrivedAt = null;
}

/**
 * Auto-end the arrived trip once the grace period has elapsed. Driven from
 * both the timer (reliable while the app is active) and `evaluate()` on every
 * location fix — iOS suspends JS timers while the phone is locked/screen-off,
 * so a timer-only auto-end left a CarPlay trip active until the phone woke.
 */
function maybeAutoEnd(): void {
  const nav = useNavigationStore.getState();
  if (!nav.isNavigating || !nav.hasArrived) {
    clearAutoEnd();
    return;
  }
  if (arrivedAt === null || Date.now() - arrivedAt < AUTO_END_DELAY_MS) return;
  clearAutoEnd();
  nav.stopNavigation();
}

/** Recompute arrival/leg progression from the two stores. Cheap and idempotent. */
function evaluate(): void {
  const nav = useNavigationStore.getState();
  const tracking = useNavigationTrackingStore.getState();

  if (!nav.isNavigating || !nav.destination) {
    if (wasNavigating) {
      wasNavigating = false;
      waypointDetector.reset();
      destinationDetector.reset();
      clearAutoEnd();
    }
    return;
  }

  if (!wasNavigating) {
    wasNavigating = true;
    waypointDetector.reset();
    destinationDetector.reset();
    clearAutoEnd();
  }

  // Arrival already latched: advance the (possibly timer-suspended) auto-end.
  if (nav.hasArrived) {
    maybeAutoEnd();
    return;
  }
  // No fix yet.
  if (!tracking.navPosition) return;

  const onFinalLeg = nav.currentLegIndex >= nav.waypoints.length;
  if (onFinalLeg) {
    const arrived = destinationDetector.update({
      distanceToTargetMeters: distanceToTargetMeters(tracking.navPosition, nav.destination),
      remainingMetersToTarget: nav.remainingDistanceMeters,
    });
    if (!arrived) return;

    nav.setArrived(true);
    if (useSettingsStore.getState().navigationAutoEnd) {
      clearAutoEnd();
      arrivedAt = Date.now();
      autoEndTimer = setTimeout(maybeAutoEnd, AUTO_END_DELAY_MS);
    }
    return;
  }

  const target = targetForLeg(nav.waypoints, nav.destination, nav.currentLegIndex);
  if (!target) return;
  const reachedWaypoint = waypointDetector.update({
    distanceToTargetMeters: distanceToTargetMeters(tracking.navPosition, target),
    remainingMetersToTarget: null,
  });
  if (!reachedWaypoint) return;

  waypointDetector.reset();
  if (useSettingsStore.getState().navigationAutoAdvanceLegs) nav.advanceLeg();
}

/** Start listening for arrival/leg transitions. Safe to call multiple times. */
export function initArrivalCoordinator(): void {
  if (initialized) return;
  initialized = true;
  const navUnsub = useNavigationStore.subscribe(evaluate);
  const trackingUnsub = useNavigationTrackingStore.subscribe(evaluate);
  unsubscribe = () => {
    navUnsub();
    trackingUnsub();
  };
  evaluate();
}

/** Stop listening. Primarily for tests. */
export function teardownArrivalCoordinator(): void {
  unsubscribe?.();
  unsubscribe = null;
  initialized = false;
  wasNavigating = false;
  waypointDetector.reset();
  destinationDetector.reset();
  clearAutoEnd();
}
