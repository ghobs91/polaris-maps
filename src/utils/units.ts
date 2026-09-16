import { useSettingsStore } from '../stores/settingsStore';

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const KMH_PER_MPH = 1.60934;

/**
 * Format a speed in mph for display, respecting the user's unit preference.
 * Internal speeds are always stored in mph.
 */
export function formatSpeed(mph: number, metric?: boolean): string {
  if (metric ?? useSettingsStore.getState().useMetric) {
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

/** Format a duration in seconds for display (e.g. "46 min", "2h 5m"). */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins} min`;
}

/**
 * Format a distance in meters for display using the user's unit preference
 * (single source of truth — not the device locale).
 * Imperial: feet below 0.1 mi, miles above.
 * Metric:   metres below 1 km, kilometres above.
 *
 * @param metric Override the preference (used by tests and pure callers).
 */
export function formatDistance(meters: number, metric?: boolean): string {
  const useMetric = metric ?? useSettingsStore.getState().useMetric;

  if (!useMetric) {
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
