/**
 * Headless turn-by-turn voice guidance.
 *
 * The navigation screen drives the same prompts while it is mounted, but a trip
 * started from CarPlay (or a backgrounded phone) never mounts that screen, so
 * nothing was spoken. This service subscribes to the navigation and tracking
 * stores and drives the prompt ladder itself — the shared tracker/`lastSpokenText`
 * dedupe in `ttsService` means the screen and this service can coexist without
 * double-speaking.
 */

import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { guidanceManeuverIndex } from '../../utils/navigationManeuvers';
import {
  announceArrival,
  announceManeuver,
  announceNavigationStart,
  announceOffRoute,
  announceRerouted,
  stopNavigationSpeech,
} from './ttsService';

let initialized = false;
let unsubscribe: (() => void) | null = null;

let wasNavigating = false;
let wasRerouting = false;
let arrivalAnnounced = false;

/**
 * Recompute the spoken state from the two stores. Runs on every navigation and
 * tracking update; `ttsService` dedupes so frequent calls are cheap.
 */
function evaluate(): void {
  const nav = useNavigationStore.getState();
  const tracking = useNavigationTrackingStore.getState();

  if (!nav.isNavigating || !nav.currentManeuver || !nav.activeRoute || !nav.destination) {
    if (wasNavigating) {
      wasNavigating = false;
      wasRerouting = false;
      arrivalAnnounced = false;
      void stopNavigationSpeech();
    }
    return;
  }

  if (!wasNavigating) {
    wasNavigating = true;
    wasRerouting = false;
    arrivalAnnounced = false;
    announceNavigationStart(nav.destination.name);
  }

  if (nav.hasArrived && !arrivalAnnounced) {
    arrivalAnnounced = true;
    announceArrival(nav.destination.name);
  }

  const rerouting = nav.isRerouting || nav.hasDeviated;
  if (rerouting && !wasRerouting) {
    wasRerouting = true;
    announceOffRoute();
  } else if (!rerouting && wasRerouting) {
    wasRerouting = false;
    announceRerouted();
  }

  const distance = tracking.distanceToTurn;
  if (distance != null) {
    // The live distance counts down to the NEXT maneuver's begin, so announce
    // that one — announcing the segment already reached is one step behind.
    const allManeuvers = nav.activeRoute.legs.flatMap((l) => l.maneuvers);
    const guidanceIdx = guidanceManeuverIndex(nav.currentStepIndex, allManeuvers);
    const guidance = allManeuvers[guidanceIdx] ?? nav.currentManeuver;
    const instruction = guidance.verbalPreTransition || guidance.instruction;
    if (instruction?.trim()) {
      announceManeuver(`${guidanceIdx}:${guidance.instruction ?? ''}`, distance, instruction);
    }
  }
}

/** Start listening for navigation transitions. Safe to call multiple times. */
export function initNavigationVoice(): void {
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
export function teardownNavigationVoice(): void {
  unsubscribe?.();
  unsubscribe = null;
  initialized = false;
  wasNavigating = false;
  wasRerouting = false;
  arrivalAnnounced = false;
}
