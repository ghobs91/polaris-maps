import {
  SEED_DISK_HEADROOM_RATIO,
  shouldSeedLocallyOnDevice,
  type LocalSeedingInput,
} from '../../src/services/regions/relaySeedingPolicy';

const base: LocalSeedingInput = {
  relayCovers: false,
  relayHealthy: false,
  userPref: 'auto',
  power: 'charging',
  link: 'unmetered',
  freeDiskRatio: 3,
};

describe('shouldSeedLocallyOnDevice', () => {
  it('does not seed a region a healthy relay covers', () => {
    const decision = shouldSeedLocallyOnDevice({ ...base, relayCovers: true, relayHealthy: true });
    expect(decision).toEqual({ seed: false, reason: 'a desktop relay is seeding this region' });
  });

  it('seeds an uncovered region on AC power with an unmetered link', () => {
    const decision = shouldSeedLocallyOnDevice(base);
    expect(decision.seed).toBe(true);
    expect(decision.reason).toBe('no relay covers this region');
  });

  it('seeds when a relay advertises the region but is not serving it', () => {
    // Coverage without health is exactly the case that must not silence a seeder:
    // the relay is pinned in theory and paused in practice.
    const decision = shouldSeedLocallyOnDevice({ ...base, relayCovers: true, relayHealthy: false });
    expect(decision.seed).toBe(true);
    expect(decision.reason).toMatch(/not serving/);
  });

  it('honours an explicit "never" over everything else', () => {
    const decision = shouldSeedLocallyOnDevice({
      ...base,
      userPref: 'never',
      relayCovers: false,
      power: 'charging',
    });
    expect(decision.seed).toBe(false);
  });

  it('honours an explicit "always" even when a relay covers the region', () => {
    const decision = shouldSeedLocallyOnDevice({
      ...base,
      userPref: 'always',
      relayCovers: true,
      relayHealthy: true,
      power: 'battery',
      link: 'metered',
    });
    expect(decision.seed).toBe(true);
  });

  describe('fallback conditions for an uncovered region', () => {
    it('refuses on battery power', () => {
      const decision = shouldSeedLocallyOnDevice({ ...base, power: 'battery' });
      expect(decision).toEqual({ seed: false, reason: 'on battery power' });
    });

    it('refuses on a metered link', () => {
      const decision = shouldSeedLocallyOnDevice({ ...base, link: 'metered' });
      expect(decision).toEqual({ seed: false, reason: 'metered connection' });
    });

    it('refuses with no connection', () => {
      expect(shouldSeedLocallyOnDevice({ ...base, link: 'none' }).seed).toBe(false);
    });

    it('refuses without disk headroom', () => {
      const decision = shouldSeedLocallyOnDevice({ ...base, freeDiskRatio: 1.1 });
      expect(decision.seed).toBe(false);
      expect(decision.reason).toMatch(/free disk/);
    });

    it('accepts exactly the headroom threshold', () => {
      expect(
        shouldSeedLocallyOnDevice({ ...base, freeDiskRatio: SEED_DISK_HEADROOM_RATIO }).seed,
      ).toBe(true);
    });

    it('refuses an unreadable free-space value rather than guessing', () => {
      expect(shouldSeedLocallyOnDevice({ ...base, freeDiskRatio: 0 }).seed).toBe(false);
      expect(shouldSeedLocallyOnDevice({ ...base, freeDiskRatio: Number.NaN }).seed).toBe(false);
    });
  });

  it('always explains itself', () => {
    // The reason string is what the settings row and the diagnostics log show;
    // an unexplained "not seeding" is the support question this change creates.
    for (const input of [
      base,
      { ...base, relayCovers: true, relayHealthy: true },
      { ...base, userPref: 'never' as const },
      { ...base, power: 'battery' as const },
      { ...base, link: 'metered' as const },
      { ...base, freeDiskRatio: 1 },
    ]) {
      expect(shouldSeedLocallyOnDevice(input).reason.length).toBeGreaterThan(0);
    }
  });
});
