/**
 * One-hour weekday buckets for saved upstream flow data.
 *
 * The rule this store implements: if this device has already seen traffic for
 * a road at "Tuesday 15:00–15:59", asking again on a later Tuesday in that
 * same hour must use the saved answer instead of paying the provider — flow
 * patterns for a given weekday and hour change slowly, so a saved observation
 * up to a month old is the preferred answer.
 *
 * The weekly probe index keeps 30-minute buckets because probes are dense and
 * continuous; saved upstream answers are sparse (one fetch per area per visit),
 * so they are keyed by the hour the user actually asked in.
 */

/** Weekday + local hour a saved observation belongs to. */
export interface SavedFlowBucket {
  /** 0 (Sunday) … 6 (Saturday), per `Date#getDay()`. */
  dayOfWeek: number;
  /** Local hour of the day: 0 … 23. */
  hour: number;
}

/** Bucket a local timestamp (epoch ms or Date) falls into. */
export function savedFlowBucketFor(date: Date | number): SavedFlowBucket {
  const d = typeof date === 'number' ? new Date(date) : date;
  return { dayOfWeek: d.getDay(), hour: d.getHours() };
}

/** Bucket for "now" (local time). */
export function currentSavedFlowBucket(nowMs: number = Date.now()): SavedFlowBucket {
  return savedFlowBucketFor(nowMs);
}

/** Stable key for a bucket, e.g. `2:15` (Tuesday 15:xx). */
export function savedFlowBucketKey(bucket: SavedFlowBucket): string {
  return `${bucket.dayOfWeek}:${bucket.hour}`;
}

/**
 * Bucket for a 30-minute index bucket (`TimeBucket.halfHour`, 0…47), used when
 * a cascade request has to ask the saved store. Rounding down keeps the hour
 * the caller actually observed in.
 */
export function savedFlowBucketFromHalfHour(dayOfWeek: number, halfHour: number): SavedFlowBucket {
  return { dayOfWeek, hour: Math.min(23, Math.max(0, Math.floor(halfHour / 2))) };
}
