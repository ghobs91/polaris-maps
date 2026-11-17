import {
  isMajorHolidayOrEve,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
} from '../../src/services/traffic/trafficHolidayCalendar';

/** The eves/holiday pairs whose traffic patterns must stay separate. */
describe('isMajorHolidayOrEve', () => {
  it('flags fixed-date holidays and their eves', () => {
    expect(isMajorHolidayOrEve(new Date(2027, 0, 1, 0, 30, 0))).toBe(true); // New Year's Day
    expect(isMajorHolidayOrEve(new Date(2026, 11, 31, 23, 30, 0))).toBe(true); // New Year's Eve
    expect(isMajorHolidayOrEve(new Date(2026, 11, 30, 23, 30, 0))).toBe(true); // NYE eve night
    expect(isMajorHolidayOrEve(new Date(2026, 11, 25, 12, 0, 0))).toBe(true); // Christmas Day
    expect(isMajorHolidayOrEve(new Date(2026, 11, 24, 20, 0, 0))).toBe(true); // Christmas Eve
    expect(isMajorHolidayOrEve(new Date(2026, 11, 23, 20, 0, 0))).toBe(true); // its eve
    expect(isMajorHolidayOrEve(new Date(2026, 6, 4, 18, 0, 0))).toBe(true); // July 4
    expect(isMajorHolidayOrEve(new Date(2026, 6, 3, 18, 0, 0))).toBe(true); // July 3
    expect(isMajorHolidayOrEve(new Date(2026, 5, 19, 12, 0, 0))).toBe(true); // Juneteenth
  });

  it('flags the floating federal holidays for the right year', () => {
    // Thanksgiving: 4th Thursday of November — Nov 26 in 2026.
    expect(isMajorHolidayOrEve(new Date(2026, 10, 26, 12, 0, 0))).toBe(true);
    expect(isMajorHolidayOrEve(new Date(2026, 10, 25, 12, 0, 0))).toBe(true);
    // The 3rd Thursday (Nov 19, 2026) is an ordinary day.
    expect(isMajorHolidayOrEve(new Date(2026, 10, 19, 12, 0, 0))).toBe(false);
    // Memorial Day: last Monday of May — May 25 in 2026.
    expect(isMajorHolidayOrEve(new Date(2026, 4, 25, 12, 0, 0))).toBe(true);
    // Labor Day: 1st Monday of September — Sep 7 in 2026.
    expect(isMajorHolidayOrEve(new Date(2026, 8, 7, 12, 0, 0))).toBe(true);
    // MLK: 3rd Monday of January — Jan 19 in 2026.
    expect(isMajorHolidayOrEve(new Date(2026, 0, 19, 12, 0, 0))).toBe(true);
    // Presidents' Day: 3rd Monday of February — Feb 16 in 2026.
    expect(isMajorHolidayOrEve(new Date(2026, 1, 16, 12, 0, 0))).toBe(true);
  });

  it('leaves ordinary days unflagged', () => {
    expect(isMajorHolidayOrEve(new Date(2026, 11, 9, 17, 30, 0))).toBe(false); // Wed
    expect(isMajorHolidayOrEve(new Date(2026, 2, 17, 8, 0, 0))).toBe(false); // St. Patrick's
    expect(isMajorHolidayOrEve(new Date(2026, 9, 31, 21, 0, 0))).toBe(false); // Halloween
    expect(isMajorHolidayOrEve(new Date(2026, 1, 14, 19, 0, 0))).toBe(false); // Valentine's
  });

  it('handles a year boundary (Dec 31 eve night into Jan 1)', () => {
    // Dec 30 2027 is the eve of New Year's Eve 2027 (a Friday).
    expect(isMajorHolidayOrEve(new Date(2027, 11, 30, 23, 59, 0))).toBe(true);
  });
});

describe('nthWeekdayOfMonth / lastWeekdayOfMonth', () => {
  it('finds the nth weekday', () => {
    const thanksgiving = nthWeekdayOfMonth(2026, 10, 4, 4);
    expect(thanksgiving).toEqual(new Date(2026, 10, 26));
  });

  it('returns null when the month has no nth weekday', () => {
    expect(nthWeekdayOfMonth(2026, 10, 4, 5)).toBeNull(); // no 5th Thursday
  });

  it('finds the last weekday', () => {
    expect(lastWeekdayOfMonth(2026, 4, 1)).toEqual(new Date(2026, 4, 25)); // Memorial Day
  });
});
