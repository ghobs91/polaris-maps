/**
 * Minimal opening-hours parser tests for the "open now" intent.
 */

import { parseOpenNow } from '../../src/services/search/openingHours';

// Tuesday 2026-09-15 12:00 local time.
const NOON_TUE = new Date(2026, 8, 15, 12, 0, 0);
// Tuesday 2026-09-15 23:30 local time.
const LATE_TUE = new Date(2026, 8, 15, 23, 30, 0);

describe('parseOpenNow', () => {
  it('returns null for missing or unparseable hours', () => {
    expect(parseOpenNow(null, NOON_TUE)).toBeNull();
    expect(parseOpenNow('', NOON_TUE)).toBeNull();
    expect(parseOpenNow('sunrise-sunset', NOON_TUE)).toBeNull();
    expect(parseOpenNow('closed', NOON_TUE)).toBeNull();
  });

  it('handles 24/7', () => {
    expect(parseOpenNow('24/7', NOON_TUE)).toBe(true);
  });

  it('evaluates weekday ranges', () => {
    expect(parseOpenNow('Mo-Fr 09:00-17:00', NOON_TUE)).toBe(true);
    expect(parseOpenNow('Mo-Fr 09:00-11:00', NOON_TUE)).toBe(false);
    expect(parseOpenNow('Sa-Su 09:00-17:00', NOON_TUE)).toBe(false);
  });

  it('handles day lists and multiple rules', () => {
    expect(parseOpenNow('Tu,Th 08:00-20:00; Sa 10:00-14:00', NOON_TUE)).toBe(true);
    expect(parseOpenNow('Mo,We,Fr 08:00-20:00', NOON_TUE)).toBe(false);
  });

  it('handles overnight ranges', () => {
    expect(parseOpenNow('Mo-Su 18:00-02:00', LATE_TUE)).toBe(true);
    expect(parseOpenNow('Mo-Su 18:00-02:00', NOON_TUE)).toBe(false);
  });
});
