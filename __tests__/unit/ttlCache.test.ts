import { TtlCache } from '../../src/utils/ttlCache';

function makeClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('TtlCache', () => {
  it('returns a value while it is within the TTL', () => {
    const clock = makeClock();
    const cache = new TtlCache<string, string>(60_000, 4, clock.now);

    cache.set('a', 'first');
    clock.advance(59_999);

    expect(cache.get('a')).toBe('first');
  });

  it('drops a value once the TTL has elapsed', () => {
    const clock = makeClock();
    const cache = new TtlCache<string, string>(60_000, 4, clock.now);

    cache.set('a', 'first');
    clock.advance(60_000);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest insertion when the size bound is exceeded', () => {
    const clock = makeClock();
    const cache = new TtlCache<string, number>(60_000, 2, clock.now);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('treats a re-set value as the newest entry', () => {
    const clock = makeClock();
    const cache = new TtlCache<string, number>(60_000, 2, clock.now);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);

    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('prunes expired entries when a new entry is stored', () => {
    const clock = makeClock();
    const cache = new TtlCache<string, number>(60_000, 10, clock.now);

    cache.set('old', 1);
    clock.advance(60_000);
    cache.set('new', 2);

    // `size` prunes expired entries; the stale entry must not occupy a slot.
    expect(cache.size).toBe(1);
    expect(cache.get('old')).toBeUndefined();
  });

  it('clears every entry', () => {
    const clock = makeClock();
    const cache = new TtlCache<string, number>(60_000, 4, clock.now);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});
