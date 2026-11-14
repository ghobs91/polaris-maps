/**
 * Tests for the region-pack mirror policy: load distribution across the four
 * pack origins and failure cooldowns.
 */

import {
  applyMirrorOutcome,
  cooldownMsFor,
  isCoolingDown,
  MIRROR_COOLDOWN_BASE_MS,
  MIRROR_COOLDOWN_MAX_MS,
  mirrorKeyFor,
  orderSources,
  pruneMirrorHealth,
  type MirrorHealth,
} from '../../src/services/regions/mirrorSelector';

const GITHUB =
  'https://github.com/ghobs91/polaris-maps/releases/download/map-data-1/us-ny-routing.tar';
const R2 = 'https://packs.example-r2.dev/map-data-1/us-ny-routing.tar';
const B2 = 'https://packs.s3.us-west-004.backblazeb2.com/map-data-1/us-ny-routing.tar';
const IA = 'https://archive.org/download/polaris-packs/map-data-1/us-ny-routing.tar';

const ALL = [GITHUB, R2, B2, IA];

describe('mirrorKeyFor', () => {
  it('keys by host', () => {
    expect(mirrorKeyFor(GITHUB)).toBe('github.com');
    expect(mirrorKeyFor(B2)).toBe('packs.s3.us-west-004.backblazeb2.com');
  });

  it('falls back to the raw value when the URL does not parse', () => {
    expect(mirrorKeyFor('not a url')).toBe('not a url');
  });
});

describe('orderSources', () => {
  it('dedupes while preserving first-seen order', () => {
    expect(orderSources([GITHUB, R2, GITHUB, null, undefined, '  '])).toEqual([GITHUB, R2]);
  });

  it('rotates the starting origin so load is spread across mirrors', () => {
    expect(orderSources(ALL, { rotation: 0 })[0]).toBe(GITHUB);
    expect(orderSources(ALL, { rotation: 1 })[0]).toBe(R2);
    expect(orderSources(ALL, { rotation: 2 })[0]).toBe(B2);
    expect(orderSources(ALL, { rotation: 3 })[0]).toBe(IA);
    // Wraps rather than going out of bounds.
    expect(orderSources(ALL, { rotation: 4 })[0]).toBe(GITHUB);
  });

  it('always returns every origin, never a subset', () => {
    for (let rotation = 0; rotation < 8; rotation++) {
      expect(orderSources(ALL, { rotation }).slice().sort()).toEqual(ALL.slice().sort());
    }
  });

  it('moves a recently failed origin to the back', () => {
    const health: MirrorHealth = {
      [mirrorKeyFor(GITHUB)]: { failures: 1, lastFailureAt: 1_000, lastSuccessAt: 0 },
    };
    const ordered = orderSources(ALL, { health, rotation: 0, now: 1_001 });
    expect(ordered).not.toContain(undefined);
    expect(ordered[ordered.length - 1]).toBe(GITHUB);
    expect(ordered.slice(0, 3)).toEqual([R2, B2, IA]);
  });

  it('prefers an origin whose cooldown has expired', () => {
    const now = 1_000_000;
    const health: MirrorHealth = {
      [mirrorKeyFor(GITHUB)]: {
        failures: 1,
        lastFailureAt: now - MIRROR_COOLDOWN_BASE_MS - 1,
        lastSuccessAt: 0,
      },
    };
    expect(orderSources(ALL, { health, rotation: 0, now })[0]).toBe(GITHUB);
  });

  it('still returns cooling origins when every origin is cooling', () => {
    const now = 10_000;
    const health: MirrorHealth = Object.fromEntries(
      ALL.map((url) => [
        mirrorKeyFor(url),
        { failures: 2, lastFailureAt: now - 1, lastSuccessAt: 0 },
      ]),
    );
    const ordered = orderSources(ALL, { health, rotation: 0, now });
    expect(ordered).toHaveLength(4);
  });

  it('orders cooling origins by soonest recovery', () => {
    const now = 10_000;
    const health: MirrorHealth = {
      [mirrorKeyFor(GITHUB)]: { failures: 2, lastFailureAt: now - 1, lastSuccessAt: 0 },
      [mirrorKeyFor(R2)]: { failures: 1, lastFailureAt: now - 1, lastSuccessAt: 0 },
      [mirrorKeyFor(B2)]: { failures: 1, lastFailureAt: now - 1, lastSuccessAt: 0 },
      [mirrorKeyFor(IA)]: { failures: 1, lastFailureAt: now - 1, lastSuccessAt: 0 },
    };
    // Two failures cool down for longer than one, so GitHub recovers last.
    const ordered = orderSources(ALL, { health, rotation: 0, now });
    expect(ordered[ordered.length - 1]).toBe(GITHUB);
  });
});

describe('cooldownMsFor', () => {
  it('is zero with no failures', () => {
    expect(cooldownMsFor(0)).toBe(0);
  });

  it('doubles per consecutive failure and caps', () => {
    expect(cooldownMsFor(1)).toBe(MIRROR_COOLDOWN_BASE_MS);
    expect(cooldownMsFor(2)).toBe(MIRROR_COOLDOWN_BASE_MS * 2);
    expect(cooldownMsFor(50)).toBe(MIRROR_COOLDOWN_MAX_MS);
  });

  it('is only active inside the window', () => {
    const entry = { failures: 1, lastFailureAt: 1_000, lastSuccessAt: 0 };
    expect(isCoolingDown(entry, 1_000 + MIRROR_COOLDOWN_BASE_MS - 1)).toBe(true);
    expect(isCoolingDown(entry, 1_000 + MIRROR_COOLDOWN_BASE_MS)).toBe(false);
  });
});

describe('applyMirrorOutcome', () => {
  it('increments failures without mutating the input', () => {
    const before: MirrorHealth = {};
    const after = applyMirrorOutcome(before, GITHUB, 'failure', 5_000);
    expect(before).toEqual({});
    expect(after[mirrorKeyFor(GITHUB)]).toEqual({
      failures: 1,
      lastFailureAt: 5_000,
      lastSuccessAt: 0,
    });
  });

  it('clears the failure streak on success', () => {
    const failed = applyMirrorOutcome({}, GITHUB, 'failure', 1);
    const succeeded = applyMirrorOutcome(failed, GITHUB, 'success', 2);
    expect(succeeded[mirrorKeyFor(GITHUB)]?.failures).toBe(0);
    expect(succeeded[mirrorKeyFor(GITHUB)]?.lastSuccessAt).toBe(2);
  });
});

describe('pruneMirrorHealth', () => {
  it('drops entries older than the max age', () => {
    const now = Date.now();
    const health: MirrorHealth = {
      stale: { failures: 1, lastFailureAt: now - 2 * 24 * 60 * 60_000, lastSuccessAt: 0 },
      fresh: { failures: 1, lastFailureAt: now - 1_000, lastSuccessAt: 0 },
    };
    expect(Object.keys(pruneMirrorHealth(health, now))).toEqual(['fresh']);
  });
});
