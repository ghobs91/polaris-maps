/** Advance-distance voice prompt ladder (pure logic, unit-testable). */

export type AnnouncementBand = 'far' | 'mid' | 'near' | 'now';

interface BandSpec {
  band: AnnouncementBand;
  maxMeters: number;
}

/** Descending distance thresholds; the first band whose max covers the distance wins. */
export const ANNOUNCEMENT_BANDS: readonly BandSpec[] = [
  { band: 'far', maxMeters: 1600 },
  { band: 'mid', maxMeters: 800 },
  { band: 'near', maxMeters: 300 },
  { band: 'now', maxMeters: 80 },
];

export function bandForDistance(distanceMeters: number): AnnouncementBand | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  // Pick the tightest band that still covers the distance (nearest max ≥ distance),
  // scanning from the closest band outward.
  for (let i = ANNOUNCEMENT_BANDS.length - 1; i >= 0; i--) {
    const spec = ANNOUNCEMENT_BANDS[i];
    if (distanceMeters <= spec.maxMeters) return spec.band;
  }
  return null;
}

/**
 * Build the spoken text for a band. The immediate ("now") band speaks the bare
 * instruction; all others prefix the distance (formatted in the user's units).
 */
export function announcementText(
  band: AnnouncementBand,
  distanceMeters: number,
  instruction: string,
  formatDistance: (meters: number) => string,
): string {
  const text = instruction.trim();
  if (!text) return '';
  if (band === 'now') return text;
  return `In ${formatDistance(distanceMeters)}, ${text}`;
}

export interface Announcement {
  band: AnnouncementBand;
  distanceMeters: number;
}

/**
 * Tracks which bands have already been announced for the current maneuver so
 * each distance band fires at most once per maneuver. Advancing to a new
 * maneuver (or a reroute reset) clears the state.
 */
export class VoiceAnnouncementTracker {
  private maneuverKey: string | null = null;
  private announced = new Set<AnnouncementBand>();

  reset(): void {
    this.maneuverKey = null;
    this.announced.clear();
  }

  next(maneuverKey: string, distanceMeters: number): Announcement | null {
    if (maneuverKey !== this.maneuverKey) {
      this.maneuverKey = maneuverKey;
      this.announced.clear();
    }

    const band = bandForDistance(distanceMeters);
    if (!band || this.announced.has(band)) return null;

    // Mark this band and every farther band as announced so a stale, more
    // distant prompt cannot fire after the vehicle has already passed it.
    // Nearer bands remain eligible until reached.
    for (const spec of ANNOUNCEMENT_BANDS) {
      if (spec.maxMeters >= distanceMeters) this.announced.add(spec.band);
    }

    return { band, distanceMeters };
  }
}
