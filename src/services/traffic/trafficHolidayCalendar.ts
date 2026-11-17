/**
 * Major-holiday calendar for traffic bucketing.
 *
 * Traffic patterns on major holidays (and their eves) deviate sharply from
 * the same weekday at the same time on an ordinary week — a Friday 23:30
 * before New Year's Eve is nothing like a regular Friday 23:30. Rows observed
 * on such a day are therefore recorded under a separate holiday key instead
 * of being EMA-averaged into the regular weekly profile.
 *
 * The list is intentionally US-major-holidays only: these are fixed or
 * computable dates with strong, near-nationwide traffic deviations. Floating
 * religious/regional observances (Easter, Lunar New Year, …) are deliberately
 * excluded — a wrong "holiday" flag splits a cell's data across keys, which
 * is worse than averaging a mildly atypical day into the weekly profile.
 */

/** US federal-style major holidays + their eves, as local calendar dates. */
export const HOLIDAY_CALENDAR_VERSION = 1;

type DateLike = { getFullYear: () => number; getMonth: () => number; getDate: () => number };

/** Nth `weekday` (0=Sun…6=Sat) of `month` (0=Jan…11=Dec), or null when none. */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): Date | null {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const probe = new Date(year, month, day);
  return probe.getMonth() === month ? probe : null;
}

/** Last `weekday` of `month`. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const end = new Date(year, month + 1, 0); // last day of month
  const offset = (end.getDay() - weekday + 7) % 7;
  return new Date(year, month, end.getDate() - offset);
}

/** Fixed-date holiday of `date`'s year, or null. */
function fixedDate(date: DateLike, month: number, day: number): boolean {
  return date.getMonth() === month && date.getDate() === day;
}

/**
 * Whether the given local date is a major holiday or the eve of one.
 *
 * A date matches when it *is* the holiday or the calendar day before one, so
 * the whole observed deviation window (e.g. the evening of Dec 30 into the
 * early hours of Dec 31) is captured, not just the holiday itself.
 */
export function isMajorHolidayOrEve(date: Date): boolean {
  const year = date.getFullYear();
  const nextDay = new Date(year, date.getMonth(), date.getDate() + 1);
  return isHolidayItself(date, year) || isHolidayItself(nextDay, nextDay.getFullYear());
}

function isHolidayItself(date: DateLike, year: number): boolean {
  // Fixed-date holidays
  if (fixedDate(date, 0, 1)) return true; // New Year's Day
  if (fixedDate(date, 5, 19)) return true; // Juneteenth
  if (fixedDate(date, 6, 4)) return true; // Independence Day
  if (fixedDate(date, 11, 24)) return true; // Christmas Eve
  if (fixedDate(date, 11, 25)) return true; // Christmas Day
  if (fixedDate(date, 11, 31)) return true; // New Year's Eve

  // Floating federal holidays
  const mlk = nthWeekdayOfMonth(year, 0, 1, 3); // 3rd Monday of January
  if (mlk && sameDay(date, mlk)) return true;
  const presidents = nthWeekdayOfMonth(year, 1, 1, 3); // 3rd Monday of February
  if (presidents && sameDay(date, presidents)) return true;
  const memorial = lastWeekdayOfMonth(year, 4, 1); // last Monday of May
  if (memorial && sameDay(date, memorial)) return true;
  const labor = nthWeekdayOfMonth(year, 8, 1, 1); // 1st Monday of September
  if (labor && sameDay(date, labor)) return true;
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4); // 4th Thursday of November
  if (thanksgiving && sameDay(date, thanksgiving)) return true;

  return false;
}

function sameDay(a: DateLike, b: DateLike): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
