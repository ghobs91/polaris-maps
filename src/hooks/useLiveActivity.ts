import { useEffect, useRef } from 'react';
import { useNavigationStore } from '@/stores/navigationStore';
import type { CostingModel } from '@/models/route';
import {
  startActivity,
  updateActivity,
  endActivity,
  isSupported,
  isAvailable,
} from '@/native/liveActivity';

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

    const isActive = (): boolean => {
      const s = useNavigationStore.getState();
      return (
        s.isNavigating &&
        s.activeRoute != null &&
        s.etaSeconds != null &&
        s.remainingDistanceMeters != null &&
        s.currentManeuver != null
      );
    };

    const commit = () => {
      if (!isAvailable || cancelled) return;
      const s = useNavigationStore.getState();
      if (!isActive()) return;

      const instruction = s.currentManeuver!.verbalPreTransition || s.currentManeuver!.instruction;
      const streetName = s.currentManeuver!.streetNames?.[0];
      const maneuverIdx = s.currentStepIndex;
      const now = Date.now();

      if (!activityRef.current.started) {
        activityRef.current.started = true;
        activityRef.current.prevManeuverIdx = maneuverIdx;
        activityRef.current.lastUpdateTime = now;
        startActivity({
          etaSeconds: s.etaSeconds!,
          remainingDistanceMeters: s.remainingDistanceMeters!,
          maneuverType: s.currentManeuver!.type,
          maneuverInstruction: instruction,
          streetName,
          destinationName: destinationName(s.destination, s.costing),
          transportMode: s.costing,
        });
      } else if (
        maneuverIdx !== activityRef.current.prevManeuverIdx ||
        now - activityRef.current.lastUpdateTime >= 10_000
      ) {
        activityRef.current.prevManeuverIdx = maneuverIdx;
        activityRef.current.lastUpdateTime = now;
        updateActivity({
          etaSeconds: s.etaSeconds!,
          remainingDistanceMeters: s.remainingDistanceMeters!,
          maneuverType: s.currentManeuver!.type,
          maneuverInstruction: instruction,
          streetName,
        });
      }
    };

    const maybeEnd = () => {
      const s = useNavigationStore.getState();
      if (activityRef.current.started && !s.isNavigating) {
        activityRef.current.started = false;
        activityRef.current.prevManeuverIdx = -1;
        endActivity();
      }
    };

    // zustand's subscribe does not emit the current snapshot, so a navigation
    // that already became active before we subscribed would be missed. Check
    // once synchronously, then keep the Live Activity in sync on every change.
    unsub = useNavigationStore.subscribe(() => {
      commit();
      maybeEnd();
    });
    commit();

    // If Live Activities became unavailable after mount, tear down.
    void isSupported().then((supported) => {
      if (cancelled || supported) return;
      if (activityRef.current.started) {
        activityRef.current.started = false;
        activityRef.current.prevManeuverIdx = -1;
        endActivity();
      }
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
