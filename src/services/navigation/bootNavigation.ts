import { hasCompletedConsent } from '../identity/consent';
import { initNavigationBackgroundSession } from './backgroundSessionCoordinator';
import { initArrivalCoordinator } from './arrivalCoordinator';
import { initFixDrivenRefresh } from './fixDrivenRefresh';
import { initNavigationVoice } from '../tts/navigationVoice';

/**
 * Initialise the headless navigation lifecycle at JS bundle-load time, before
 * React mounts.
 *
 * A CarPlay cold launch — the phone app closed, phone display off — creates only
 * the CarPlay scene: there is no phone window. React Native still loads and runs
 * the bundle, but React passive effects wait on the phone's display link, which
 * does not tick without a window. So the `app/_layout.tsx` effect that owns these
 * coordinators never runs, and a trip started from CarPlay draws the route but
 * never tracks it: no live position/countdown pushes (the CarPlay map stays
 * fitted to the whole route instead of following the car), no spoken prompts, no
 * arrival auto-end, and no fix-driven traffic refresh — until the phone app is
 * opened and its window starts the display link.
 *
 * Gated on consent (the same gate `app/_layout.tsx` and `bootCarPlay` use) and
 * idempotent: every initialiser no-ops after its first call, so the
 * `app/_layout.tsx` effect still runs them on a normal launch and re-runs them
 * once a fresh consent flow completes with the phone UI mounted.
 */
export function bootNavigation(): void {
  if (!hasCompletedConsent()) return;
  initNavigationBackgroundSession();
  initNavigationVoice();
  initArrivalCoordinator();
  initFixDrivenRefresh();
}
