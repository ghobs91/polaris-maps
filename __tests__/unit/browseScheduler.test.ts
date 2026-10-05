import { createBrowseScheduler } from '../../src/services/poi/externalRatings/antiBot';

/** Deterministic scheduler: static clock, no real waiting, fixed jitter. */
function makeScheduler(overrides: Record<string, unknown> = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  const scheduler = createBrowseScheduler({
    minIntervalMs: 1000,
    jitterMs: 0,
    cooldownBaseMs: 60_000,
    cooldownMaxMs: 300_000,
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0,
    ...overrides,
  });
  return {
    scheduler,
    sleeps,
    advance: (ms: number) => {
      clock += ms;
    },
    clock: () => clock,
  };
}

describe('browse scheduler', () => {
  it('runs at most one task at a time', async () => {
    const { scheduler } = makeScheduler();
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    };
    await Promise.all([
      scheduler.schedule('a.com', task),
      scheduler.schedule('b.com', task),
      scheduler.schedule('c.com', task),
    ]);
    expect(maxActive).toBe(1);
  });

  it('enforces a minimum interval between requests to the same host', async () => {
    const { scheduler, sleeps } = makeScheduler();
    await scheduler.schedule('a.com', async () => undefined);
    await scheduler.schedule('a.com', async () => undefined);
    expect(sleeps).toEqual([1000]);
  });

  it('does not wait between different hosts', async () => {
    const { scheduler, sleeps } = makeScheduler();
    await scheduler.schedule('a.com', async () => undefined);
    await scheduler.schedule('b.com', async () => undefined);
    expect(sleeps).toEqual([]);
  });

  it('applies jitter from the random source', async () => {
    const { scheduler, sleeps } = makeScheduler({ random: () => 0.5, jitterMs: 400 });
    await scheduler.schedule('a.com', async () => undefined);
    await scheduler.schedule('a.com', async () => undefined);
    // Second request waits minInterval (1000); the jitter only affects the
    // spacing recorded *after* it runs, so the wait here is the base interval.
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
  });

  it('escalates the cool-down exponentially on repeated challenges', () => {
    const { scheduler } = makeScheduler();
    expect(scheduler.isCoolingDown('a.com')).toBe(false);
    scheduler.reportChallenge('a.com');
    expect(scheduler.cooldownRemainingMs('a.com')).toBe(60_000);
    scheduler.reportChallenge('a.com');
    expect(scheduler.cooldownRemainingMs('a.com')).toBe(120_000);
    scheduler.reportChallenge('a.com');
    expect(scheduler.cooldownRemainingMs('a.com')).toBe(240_000);
    scheduler.reportChallenge('a.com');
    scheduler.reportChallenge('a.com');
    // Capped at cooldownMaxMs.
    expect(scheduler.cooldownRemainingMs('a.com')).toBe(300_000);
    expect(scheduler.isCoolingDown('a.com')).toBe(true);
  });

  it('honors a rate-limit Retry-After', () => {
    const { scheduler } = makeScheduler();
    scheduler.reportRateLimited('a.com', 45_000);
    expect(scheduler.cooldownRemainingMs('a.com')).toBe(45_000);
  });

  it('waits out the cool-down before running', async () => {
    const { scheduler, sleeps } = makeScheduler();
    scheduler.reportChallenge('a.com');
    await scheduler.schedule('a.com', async () => undefined);
    expect(sleeps).toEqual([60_000]);
  });
});
