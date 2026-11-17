import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkEgress,
  createTokenBucket,
  monthKey,
  recordEgress,
  rollUsage,
} from '../src/budgets.mjs';

test('monthKey buckets by UTC month', () => {
  assert.equal(monthKey(Date.UTC(2026, 1, 14, 23, 59)), '2026-02');
  assert.equal(monthKey(Date.UTC(2026, 2, 1, 0, 1)), '2026-03');
});

test('rollUsage resets the counter when the month changes', () => {
  const feb = Date.UTC(2026, 1, 14);
  assert.deepEqual(rollUsage({ month: '2026-02', bytes: 100 }, feb), {
    month: '2026-02',
    bytes: 100,
  });
  assert.deepEqual(rollUsage({ month: '2026-01', bytes: 100 }, feb), {
    month: '2026-02',
    bytes: 0,
  });
});

test('checkEgress allows serving below the cap and stops at it', () => {
  const now = Date.UTC(2026, 1, 14);
  const cap = 1_000;

  const below = checkEgress({ month: '2026-02', bytes: 999 }, cap, now);
  assert.equal(below.allowed, true);
  assert.equal(below.reason, null);

  const at = checkEgress({ month: '2026-02', bytes: 1_000 }, cap, now);
  assert.equal(at.allowed, false);
  assert.match(at.reason, /monthly egress cap reached/);
});

test('checkEgress treats a zero cap as unlimited', () => {
  const now = Date.UTC(2026, 1, 14);
  const result = checkEgress({ month: '2026-02', bytes: 10 ** 15 }, 0, now);
  assert.equal(result.allowed, true);
  assert.equal(result.capBytes, 0);
});

test('a cap reached last month does not block this month', () => {
  const march = Date.UTC(2026, 2, 2);
  const result = checkEgress({ month: '2026-02', bytes: 10 ** 12 }, 1_000, march);
  assert.equal(result.allowed, true);
  assert.equal(result.usedBytes, 0);
});

test('recordEgress accumulates and rolls over', () => {
  const now = Date.UTC(2026, 1, 14);
  const first = recordEgress({ month: '2026-02', bytes: 10 }, 5, now);
  assert.deepEqual(first, { month: '2026-02', bytes: 15 });

  const nextMonth = recordEgress({ month: '2026-01', bytes: 10 }, 5, Date.UTC(2026, 2, 1));
  assert.deepEqual(nextMonth, { month: '2026-03', bytes: 5 });
});

test('recordEgress ignores negative and non-numeric input', () => {
  const now = Date.UTC(2026, 1, 14);
  assert.deepEqual(recordEgress({ month: '2026-02', bytes: 10 }, -5, now), {
    month: '2026-02',
    bytes: 10,
  });
  assert.deepEqual(recordEgress({ month: '2026-02', bytes: 10 }, Number.NaN, now), {
    month: '2026-02',
    bytes: 10,
  });
});

test('token bucket refills over time and reports a wait when empty', () => {
  const bucket = createTokenBucket({ bytesPerSecond: 100, capacityBytes: 100 });
  const t0 = 1_000_000;

  assert.equal(bucket.take(100, t0).allowed, true);
  const blocked = bucket.take(100, t0);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.waitMs > 0);

  // A full second later the bucket is back to capacity.
  assert.equal(bucket.take(100, t0 + 1_000).allowed, true);
});

test('token bucket never grows past its capacity', () => {
  const bucket = createTokenBucket({ bytesPerSecond: 100, capacityBytes: 100 });
  const t0 = 1_000_000;
  bucket.take(1, t0);
  bucket.take(0, t0 + 60_000);
  assert.ok(bucket.available() <= 100);
});
