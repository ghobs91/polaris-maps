/**
 * Pure snap-point resolution for the shared bottom sheet, kept separate from
 * Reanimated worklets so the thresholds are unit-testable.
 */

export interface ResolveSheetSnapInput {
  /** Current sheet top position in px from the top of the screen. */
  currentTop: number;
  /** Snap top positions in px, sorted ascending (tallest sheet first). */
  snapTops: number[];
  /** Gesture velocity in px/s; positive is downward. */
  velocityY: number;
  screenHeight: number;
  dismissVelocity?: number;
  dismissFraction?: number;
  projectionSeconds?: number;
}

export interface SheetSnapResult {
  dismiss: boolean;
  /** Chosen snap index when `dismiss` is false. */
  index: number;
}

/** Convert height fractions (ascending) into sheet top positions (ascending). */
export function snapTopsForFractions(fractions: readonly number[], screenHeight: number): number[] {
  return fractions.map((fraction) => screenHeight * (1 - fraction)).sort((a, b) => a - b);
}

/**
 * Pick the snap target (or dismissal) for a released drag. A fast downward
 * fling, or a release projected below the lowest snap, dismisses; otherwise the
 * nearest snap to the velocity-projected position wins.
 */
export function resolveSheetSnap(input: ResolveSheetSnapInput): SheetSnapResult {
  const { currentTop, snapTops, velocityY, screenHeight } = input;
  const dismissVelocity = input.dismissVelocity ?? 900;
  const dismissFraction = input.dismissFraction ?? 0.25;
  const projectionSeconds = input.projectionSeconds ?? 0.15;

  if (snapTops.length === 0) return { dismiss: true, index: 0 };

  const lowest = snapTops[snapTops.length - 1];
  if (velocityY >= dismissVelocity) return { dismiss: true, index: snapTops.length - 1 };

  const projected = currentTop + velocityY * projectionSeconds;
  if (projected > lowest + dismissFraction * screenHeight) {
    return { dismiss: true, index: snapTops.length - 1 };
  }

  let index = 0;
  let best = Infinity;
  for (let i = 0; i < snapTops.length; i++) {
    const distance = Math.abs(snapTops[i] - projected);
    if (distance < best) {
      best = distance;
      index = i;
    }
  }
  return { dismiss: false, index };
}
