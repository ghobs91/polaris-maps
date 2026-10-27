import React, { useEffect, useRef } from 'react';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useDashCamStore } from '../../stores/dashCamStore';
import { isDrivingCosting } from '../../services/imagery/streetViewCaptureLogic';
import { askDashCamStartPreference } from '../../services/dashcam/dashCamPrompt';
import { dashCamStartForNavigation } from '../../services/dashcam/dashCamStartLogic';
import { requestDashCamStart, stopDashCam } from '../../services/dashcam/dashCamSession';
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
 * Root-mounted coordinator for on-drive capture, for both the dash cam and
 * street imagery, whichever surface (phone or CarPlay) started the trip.
 *
 * The dash cam is the feature users meet first: the very first navigation
 * start asks once whether it should run on every drive, and the answer is
 * never asked about again. Street imagery has no dialog here at all — it is
 * enabled and set to auto-start from Settings, and then it simply runs.
 */
export function StreetViewContribution() {
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const costing = useNavigationStore((s) => s.costing);
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
      if (!isDrivingCosting(costing)) return;
      void (async () => {
        // Dash cam first: the one-time question decides how every later drive
        // starts, so the answer is read back after it settles.
        const decision = dashCamStartForNavigation(useSettingsStore.getState().dashCam);
        if (decision.ask) {
          const preference = await askDashCamStartPreference();
          if (preference === 'every-drive') {
            await requestDashCamStart('auto');
          }
        } else if (decision.start) {
          await requestDashCamStart('auto');
        }

        // Street imagery never prompts here; it is a Settings-only decision.
        const streetView = useSettingsStore.getState().streetView;
        if (streetView.enabled && streetView.autoStart) {
          await requestStreetViewStart('auto');
        }
      })().catch(() => {
        // A failed DB/permission start must not break navigation.
      });
      return;
    }

    if (wasNavigating && !isNavigating) {
      // An auto-started dash cam belongs to this drive; a manual one keeps
      // rolling until the user stops it.
      if (useDashCamStore.getState().startedBy === 'auto') {
        stopDashCam();
      }
      if (useStreetViewCaptureStore.getState().session) {
        void endStreetViewSession().catch(() => {});
      }
    }
  }, [isNavigating, costing]);

  return (
    <>
      <CaptureHost />
      <DriveUploadSheet />
    </>
  );
}
