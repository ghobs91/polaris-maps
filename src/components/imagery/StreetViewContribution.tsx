import React, { useEffect, useRef } from 'react';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { isDrivingCosting } from '../../services/imagery/streetViewCaptureLogic';
import {
  askAutoStartPreference,
  confirmStreetViewConsent,
} from '../../services/imagery/streetViewConsent';
import {
  endStreetViewSession,
  requestStreetViewStart,
} from '../../services/imagery/streetViewSession';
import {
  listPendingDrives,
  recoverInterruptedDrives,
} from '../../services/imagery/streetViewQueue';
import { CaptureHost } from './CaptureHost';
import { DriveUploadSheet } from './DriveUploadSheet';

/**
 * Headless-ish coordinator for street-imagery capture. Mounted once in the
 * root layout so it sees navigation start/end regardless of which screen (or
 * CarPlay surface) started the trip.
 */
export function StreetViewContribution() {
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const costing = useNavigationStore((s) => s.costing);
  const streetView = useSettingsStore((s) => s.streetView);
  const prevNavigating = useRef(isNavigating);

  // Recover drives orphaned by a process kill and surface the newest one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await recoverInterruptedDrives().catch(() => 0);
      const pending = await listPendingDrives().catch(() => []);
      if (cancelled || pending.length === 0) return;
      const store = useStreetViewCaptureStore.getState();
      if (!store.pendingDriveId && !store.session && !useNavigationStore.getState().isNavigating) {
        store.setPendingDriveId(pending[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const wasNavigating = prevNavigating.current;
    prevNavigating.current = isNavigating;

    if (!wasNavigating && isNavigating) {
      if (!streetView.enabled || !isDrivingCosting(costing)) return;
      void (async () => {
        // The consent explainer comes before any capture. The auto-start
        // question is separate and only asked once.
        const accepted = await confirmStreetViewConsent();
        if (!accepted) return;

        const current = useSettingsStore.getState().streetView;
        if (!current.autoStartPromptAnswered && !current.autoStart) {
          const turnOn = await askAutoStartPreference();
          if (!turnOn) return;
        } else if (!current.autoStart) {
          return;
        }

        await requestStreetViewStart('auto');
      })().catch(() => {
        // A failed DB/permission start must not break navigation.
      });
      return;
    }

    if (wasNavigating && !isNavigating) {
      if (useStreetViewCaptureStore.getState().session) {
        void endStreetViewSession().catch(() => {});
      }
    }
  }, [isNavigating, costing, streetView.enabled, streetView.autoStartPromptAnswered]);

  return (
    <>
      <CaptureHost />
      <DriveUploadSheet />
    </>
  );
}
