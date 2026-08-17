import type { TimeBucket } from '../../models/trafficHistory';

/**
 * 30-minute time-of-day bucketing, day-of-week aware.
 *
 * Buckets are local-time based (the traffic patterns users care about are
 * local: morning rush, evening rush, etc.).
 */

/** Convert a Date (or epoch ms) into a day-of-week + half-hour bucket. */
export function timeBucketFor(date: Date | number): TimeBucket {
  const d = typeof date === 'number' ? new Date(date) : date;
  return {
    dayOfWeek: d.getDay(),
    halfHour: Math.floor((d.getHours() * 60 + d.getMinutes()) / 30),
  };
}

/** Bucket for "now" (local time). */
export function currentTimeBucket(): TimeBucket {
  return timeBucketFor(new Date());
}

/** Minute-of-day at which a bucket starts (0…1410). */
export function bucketStartMinute(bucket: TimeBucket): number {
  return bucket.halfHour * 30;
}

/** Minute-of-day at which a bucket ends, exclusive (30…1440). */
export function bucketEndMinute(bucket: TimeBucket): number {
  return bucketStartMinute(bucket) + 30;
}

/** Stable sortable week key for a bucket, e.g. "3:30" (Wednesday 15:00). */
export function bucketKey(bucket: TimeBucket): string {
  return `${bucket.dayOfWeek}:${bucket.halfHour}`;
}

/** Human-readable label for a bucket, e.g. "Wed 15:00–15:30". */
export function bucketLabel(bucket: TimeBucket): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const start = bucketStartMinute(bucket);
  const end = bucketEndMinute(bucket);
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${days[bucket.dayOfWeek]} ${fmt(start)}–${fmt(end)}`;
}

/** All 336 buckets of the week in order (Sunday 00:00 … Saturday 23:30). */
export function allWeeklyBuckets(): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hh = 0; hh < 48; hh++) {
      buckets.push({ dayOfWeek: dow, halfHour: hh });
    }
  }
  return buckets;
}

/** Nearest bucket index distance across the week boundary (0–168 half-hours). */
export function weeklyBucketDistance(a: TimeBucket, b: TimeBucket): number {
  const aPos = a.dayOfWeek * 48 + a.halfHour;
  const bPos = b.dayOfWeek * 48 + b.halfHour;
  const diff = Math.abs(aPos - bPos);
  return Math.min(diff, 336 - diff);
}
