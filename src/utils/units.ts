const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/**
 * Returns true if the device locale uses imperial (US customary) units for distances.
 * Covers the US (miles + feet). UK uses miles but that's handled separately if needed.
 */
function deviceUsesImperial(): boolean {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    // en-US or any xx-US tag
    return /-US$/i.test(locale);
  } catch {
    return false;
  }
}

export const useImperial = deviceUsesImperial();

/**
 * Format a distance in meters for display, respecting the device's unit system.
 * Imperial: feet below 0.1 mi, miles above.
 * Metric:   metres below 1 km, kilometres above.
 */
const KMH_PER_MPH = 1.60934;

/**
 * Format a speed in mph for display, respecting the user's unit preference.
 * Internal speeds are always stored in mph.
 */
export function formatSpeed(mph: number, metric?: boolean): string {
  if (metric) {
    const kmh = mph * KMH_PER_MPH;
    return `${Math.round(kmh)} km/h`;
  }
  return `${Math.round(mph)} mph`;
}

/** Convert mph to km/h. */
export function mphToKmh(mph: number): number {
  return mph * KMH_PER_MPH;
}

/** Convert km/h to mph. */
export function kmhToMph(kmh: number): number {
  return kmh / KMH_PER_MPH;
}

export function formatDistance(meters: number): string {
  if (useImperial) {
    const miles = meters / METERS_PER_MILE;
    if (miles < 0.1) {
      const feet = Math.round(meters / METERS_PER_FOOT / 50) * 50 || 50;
      return `${feet} ft`;
    }
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
