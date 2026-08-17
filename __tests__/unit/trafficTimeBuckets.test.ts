import {
  timeBucketFor,
  currentTimeBucket,
  bucketStartMinute,
  bucketEndMinute,
  bucketKey,
  bucketLabel,
  allWeeklyBuckets,
  weeklyBucketDistance,
} from '../../src/services/traffic/trafficTimeBuckets';

describe('timeBucketFor', () => {
  it('maps midnight to bucket 0', () => {
    const d = new Date(2026, 0, 5, 0, 0, 0); // Monday
    expect(timeBucketFor(d)).toEqual({ dayOfWeek: 1, halfHour: 0 });
  });

  it('maps the first minute of a 30-minute slot into that slot', () => {
    const d = new Date(2026, 0, 5, 8, 0, 0); // Monday 08:00
    expect(timeBucketFor(d)).toEqual({ dayOfWeek: 1, halfHour: 16 });
  });

  it('maps the last minute of a slot into that slot (08:29)', () => {
    const d = new Date(2026, 0, 5, 8, 29, 59);
    expect(timeBucketFor(d)).toEqual({ dayOfWeek: 1, halfHour: 16 });
  });

  it('rolls into the next slot at the 30-minute boundary (08:30)', () => {
    const d = new Date(2026, 0, 5, 8, 30, 0);
    expect(timeBucketFor(d)).toEqual({ dayOfWeek: 1, halfHour: 17 });
  });

  it('maps late night to bucket 47', () => {
    const d = new Date(2026, 0, 5, 23, 45, 0);
    expect(timeBucketFor(d)).toEqual({ dayOfWeek: 1, halfHour: 47 });
  });

  it('treats Sunday as day 0 and Saturday as day 6', () => {
    expect(timeBucketFor(new Date(2026, 0, 4, 12, 0, 0)).dayOfWeek).toBe(0); // Sunday
    expect(timeBucketFor(new Date(2026, 0, 10, 12, 0, 0)).dayOfWeek).toBe(6); // Saturday
  });

  it('accepts epoch milliseconds', () => {
    const d = new Date(2026, 0, 5, 9, 15, 0);
    expect(timeBucketFor(d.getTime())).toEqual({ dayOfWeek: 1, halfHour: 18 });
  });
});

describe('currentTimeBucket', () => {
  it('matches timeBucketFor(new Date())', () => {
    expect(currentTimeBucket()).toEqual(timeBucketFor(new Date()));
  });
});

describe('bucketStartMinute / bucketEndMinute', () => {
  it('computes minute-of-day bounds', () => {
    expect(bucketStartMinute({ dayOfWeek: 1, halfHour: 16 })).toBe(480);
    expect(bucketEndMinute({ dayOfWeek: 1, halfHour: 16 })).toBe(510);
  });

  it('covers the full day', () => {
    expect(bucketStartMinute({ dayOfWeek: 0, halfHour: 0 })).toBe(0);
    expect(bucketEndMinute({ dayOfWeek: 6, halfHour: 47 })).toBe(1440);
  });
});

describe('bucketKey / bucketLabel', () => {
  it('produces stable keys', () => {
    expect(bucketKey({ dayOfWeek: 3, halfHour: 30 })).toBe('3:30');
  });

  it('produces human labels', () => {
    expect(bucketLabel({ dayOfWeek: 3, halfHour: 30 })).toBe('Wed 15:00–15:30');
  });
});

describe('allWeeklyBuckets', () => {
  it('produces 336 buckets in week order', () => {
    const buckets = allWeeklyBuckets();
    expect(buckets).toHaveLength(336);
    expect(buckets[0]).toEqual({ dayOfWeek: 0, halfHour: 0 });
    expect(buckets[335]).toEqual({ dayOfWeek: 6, halfHour: 47 });
  });
});

describe('weeklyBucketDistance', () => {
  it('is zero for identical buckets', () => {
    expect(weeklyBucketDistance({ dayOfWeek: 1, halfHour: 5 }, { dayOfWeek: 1, halfHour: 5 })).toBe(
      0,
    );
  });

  it('computes forward distance within a week', () => {
    expect(weeklyBucketDistance({ dayOfWeek: 0, halfHour: 0 }, { dayOfWeek: 0, halfHour: 2 })).toBe(
      2,
    );
  });

  it('wraps across the week boundary', () => {
    // Saturday 23:30 → Sunday 00:00 is distance 1, not 335
    expect(
      weeklyBucketDistance({ dayOfWeek: 6, halfHour: 47 }, { dayOfWeek: 0, halfHour: 0 }),
    ).toBe(1);
  });
});
