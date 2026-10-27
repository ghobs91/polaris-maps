/**
 * How the dash cam behaves when active navigation starts.
 *
 * The dash cam is the capture feature users are offered first: the very first
 * navigation start asks once, and the answer drives every later drive without
 * ever asking again.
 */
export interface DashCamStartPrefs {
  /** The dash cam action exists at all. */
  enabled: boolean;
  /** Start recording automatically when navigation begins. */
  autoStart: boolean;
  /** The first-run question has been answered; never ask again. */
  autoStartPromptAnswered: boolean;
}

export interface DashCamStartDecision {
  /** Show the one-time "record your drives?" question. */
  ask: boolean;
  /** Start recording right away, without asking. */
  start: boolean;
}

/**
 * Resolve the dash-cam behaviour for a navigation start.
 *
 * A user who answered "not now" keeps the record button on the navigation
 * screen — declining auto-start is not declining the feature.
 */
export function dashCamStartForNavigation(dash: DashCamStartPrefs): DashCamStartDecision {
  if (!dash.enabled) return { ask: false, start: false };
  if (!dash.autoStartPromptAnswered) return { ask: true, start: false };
  return { ask: false, start: dash.autoStart };
}
