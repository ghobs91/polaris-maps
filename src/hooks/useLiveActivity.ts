import { useEffect, useRef } from 'react';
import { useNavigationStore } from '@/stores/navigationStore';
import type { CostingModel } from '@/models/route';
import { startActivity, updateActivity, endActivity, isSupported } from '@/native/liveActivity';

function destinationName(dest: { name?: string } | null, costing: CostingModel): string {
  if (dest?.name) return dest.name;
  switch (costing) {
    case 'auto':
      return 'Destination';
    case 'pedestrian':
      return 'Destination';
    case 'bicycle':
      return 'Destination';
    case 'transit':
      return 'Destination';
    default:
      return 'Destination';
  }
}

export function useLiveActivity() {
  const activityRef = useRef({ started: false, prevManeuverIdx: -1, lastUpdateTime: 0 });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    isSupported().then((supported) => {
      if (cancelled || !supported) return;

      unsub = useNavigationStore.subscribe((state) => {
        const isActive =
          state.isNavigating &&
          state.activeRoute != null &&
          state.etaSeconds != null &&
          state.remainingDistanceMeters != null &&
          state.currentManeuver != null;

        if (isActive) {
          const instruction =
            state.currentManeuver!.verbalPreTransition || state.currentManeuver!.instruction;
          const streetName = state.currentManeuver!.streetNames?.[0];
          const maneuverIdx = state.currentStepIndex;
          const now = Date.now();

          if (!activityRef.current.started) {
            activityRef.current.started = true;
            activityRef.current.prevManeuverIdx = maneuverIdx;
            activityRef.current.lastUpdateTime = now;
            startActivity({
              etaSeconds: state.etaSeconds!,
              remainingDistanceMeters: state.remainingDistanceMeters!,
              maneuverType: state.currentManeuver!.type,
              maneuverInstruction: instruction,
              streetName,
              destinationName: destinationName(state.destination, state.costing),
              transportMode: state.costing,
            });
          } else if (
            maneuverIdx !== activityRef.current.prevManeuverIdx ||
            now - activityRef.current.lastUpdateTime >= 10_000
          ) {
            activityRef.current.prevManeuverIdx = maneuverIdx;
            activityRef.current.lastUpdateTime = now;
            updateActivity({
              etaSeconds: state.etaSeconds!,
              remainingDistanceMeters: state.remainingDistanceMeters!,
              maneuverType: state.currentManeuver!.type,
              maneuverInstruction: instruction,
              streetName,
            });
          }
        } else if (activityRef.current.started && !state.isNavigating) {
          activityRef.current.started = false;
          activityRef.current.prevManeuverIdx = -1;
          endActivity();
        }
      });
    });

    return () => {
      cancelled = true;
      unsub?.();
      if (activityRef.current.started) {
        activityRef.current.started = false;
        endActivity();
      }
    };
  }, []);
}
