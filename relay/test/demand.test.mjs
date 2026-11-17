import assert from 'node:assert/strict';
import test from 'node:test';

import { planEviction, planIdleEviction, touchDemand } from '../src/demand.mjs';

const GiB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 1, 14);

test('nothing is evicted while there is room', () => {
  const plan = planEviction(
    [{ regionId: 'a', bytes: 1 * GiB, lastRequestedAt: NOW, pinned: false }],
    { budgetBytes: 10 * GiB, incomingBytes: 1 * GiB, now: NOW, idleEvictionDays: 30 },
  );
  assert.deepEqual(plan.evict, []);
  assert.equal(plan.refused, false);
});

test('the least recently requested drive goes first', () => {
  const plan = planEviction(
    [
      { regionId: 'recent', bytes: 4 * GiB, lastRequestedAt: NOW - DAY, pinned: false },
      { regionId: 'stale', bytes: 4 * GiB, lastRequestedAt: NOW - 40 * DAY, pinned: false },
    ],
    { budgetBytes: 8 * GiB, incomingBytes: 2 * GiB, now: NOW, idleEvictionDays: 30 },
  );
  assert.deepEqual(plan.evict, ['stale']);
  assert.equal(plan.refused, false);
});

test('pinned regions are never evicted', () => {
  const plan = planEviction(
    [
      { regionId: 'pinned', bytes: 6 * GiB, lastRequestedAt: 0, pinned: true },
      { regionId: 'unpinned', bytes: 2 * GiB, lastRequestedAt: NOW - 60 * DAY, pinned: false },
    ],
    { budgetBytes: 8 * GiB, incomingBytes: 1 * GiB, now: NOW, idleEvictionDays: 30 },
  );
  assert.deepEqual(plan.evict, ['unpinned']);
  assert.equal(plan.refused, false);
});

test('it refuses rather than evict a pin when the pins alone cannot make room', () => {
  const plan = planEviction(
    [{ regionId: 'pinned', bytes: 8 * GiB, lastRequestedAt: NOW, pinned: true }],
    { budgetBytes: 8 * GiB, incomingBytes: 2 * GiB, now: NOW, idleEvictionDays: 30 },
  );
  assert.deepEqual(plan.evict, []);
  assert.equal(plan.refused, true);
  assert.match(plan.reason, /pinned bytes/);
});

test('it refuses when evicting everything still would not fit the incoming region', () => {
  const plan = planEviction(
    [{ regionId: 'a', bytes: 8 * GiB, lastRequestedAt: NOW, pinned: false }],
    { budgetBytes: 8 * GiB, incomingBytes: 9 * GiB, now: NOW, idleEvictionDays: 30 },
  );
  // Refused up front: evicting everything would still not make room, so there is
  // no point dropping a working seed to try.
  assert.deepEqual(plan.evict, []);
  assert.equal(plan.refused, true);
  assert.match(plan.reason, /cannot fit/);
});

test('idle eviction only touches unpinned drives past the window', () => {
  const evicted = planIdleEviction(
    [
      { regionId: 'idle-pinned', bytes: 1, lastRequestedAt: NOW - 90 * DAY, pinned: true },
      { regionId: 'idle', bytes: 1, lastRequestedAt: NOW - 31 * DAY, pinned: false },
      { regionId: 'fresh', bytes: 1, lastRequestedAt: NOW - 29 * DAY, pinned: false },
    ],
    { now: NOW, idleEvictionDays: 30 },
  );
  assert.deepEqual(evicted, ['idle']);
});

test('demand timestamps only move for drives that have peers', () => {
  const next = touchDemand(
    { busy: { lastRequestedAt: 1 }, quiet: { lastRequestedAt: 2 } },
    [
      { regionId: 'busy', peers: 2 },
      { regionId: 'quiet', peers: 0 },
      { regionId: 'new', peers: 0 },
    ],
    NOW,
  );
  assert.equal(next.busy.lastRequestedAt, NOW);
  assert.equal(next.quiet.lastRequestedAt, 2);
  assert.equal(next.new.lastRequestedAt, 0);
});
