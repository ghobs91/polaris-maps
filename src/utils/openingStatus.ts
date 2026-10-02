/**
 * Human-readable open/closed status from an OpenStreetMap `opening_hours`
 * string.
 *
 * Deliberately a small subset parser (the same spirit as
 * `services/search/openingHours`): it covers the shapes that dominate real OSM
 * data — `24/7`, `Mo-Fr 09:00-17:00`, `Sa,Su 10:00-16:00`, multiple ranges per
 * day, and overnight ranges. Anything it cannot understand returns
 * `{ open: null, text: null }` so the UI shows nothing rather than guessing.
 */

const DAY_INDEX: Record<string, number> = {
  su: 0,
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Interval {
  start: number;
  end: number;
}

export interface OpeningStatus {
  /** True/false when known, null when the hours are missing/unparseable. */
  open: boolean | null;
  /** e.g. "Open · Closes 5 PM" or "Closed · Opens 8 AM". Null when unknown. */
  text: string | null;
}

function parseDaySpec(spec: string): number[] {
  const days = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    const range = trimmed.match(/^([a-z]{2})\s*-\s*([a-z]{2})$/);
    if (range) {
      const from = DAY_INDEX[range[1]];
      const to = DAY_INDEX[range[2]];
      if (from == null || to == null) continue;
      let day = from;
      for (let i = 0; i < 7; i++) {
        days.add(day);
        if (day === to) break;
        day = (day + 1) % 7;
      }
      continue;
    }
    const single = DAY_INDEX[trimmed];
    if (single != null) days.add(single);
  }
  return [...days];
}

function parseTimeToken(token: string): Interval | null {
  const range = token.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (range) {
    const start = Number(range[1]) * 60 + Number(range[2]);
    const end = Number(range[3]) * 60 + Number(range[4]);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return { start, end };
  }
  const openEnded = token.match(/^(\d{1,2}):(\d{2})\s*\+$/);
  if (openEnded) {
    return { start: Number(openEnded[1]) * 60 + Number(openEnded[2]), end: 24 * 60 };
  }
  return null;
}

/** Expand a rule's time spec (comma-separated ranges) into intervals. */
function parseTimeSpec(spec: string): Interval[] {
  return spec
    .split(',')
    .map((token) => parseTimeToken(token.trim()))
    .filter((interval): interval is Interval => interval !== null);
}

/** Minutes-since-midnight → "8 AM" / "8:30 AM" / "12 PM". */
export function formatClockTime(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const meridiem = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 || 12;
  return mins === 0
    ? `${hour12} ${meridiem}`
    : `${hour12}:${String(mins).padStart(2, '0')} ${meridiem}`;
}

function contains(interval: Interval, minutes: number): boolean {
  if (interval.start === interval.end) return false; // malformed / zero-length
  if (interval.start < interval.end) return minutes >= interval.start && minutes < interval.end;
  // Overnight (e.g. 20:00-02:00) wraps past midnight.
  return minutes >= interval.start || minutes < interval.end;
}

/**
 * Parse OSM opening hours into a per-weekday interval table.
 * Returns null when no usable rules were found.
 */
function buildWeeklyIntervals(raw: string): Interval[][] | null {
  const weekly: Interval[][] = [[], [], [], [], [], [], []];
  let sawRule = false;

  for (const ruleRaw of raw.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule || /^(ph|sh|off|closed)\b/i.test(rule)) continue;
    // Split into an optional day spec and the time spec.
    const dayMatch = rule.match(/^([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+(.+)$/);
    const daySpec = dayMatch?.[1];
    const timeSpec = (dayMatch?.[2] ?? rule).trim();
    if (!/\d/.test(timeSpec)) continue;
    const intervals = parseTimeSpec(timeSpec);
    if (intervals.length === 0) continue;
    sawRule = true;
    const days = daySpec ? parseDaySpec(daySpec) : [0, 1, 2, 3, 4, 5, 6];
    if (days.length === 0) continue;
    for (const day of days) weekly[day].push(...intervals);
  }

  return sawRule ? weekly : null;
}

/**
 * Describe whether a place is open now and when it next changes.
 *
 * @param raw OSM `opening_hours` value (or any equivalent string).
 * @param at Reference time — injected so the result is deterministic in tests.
 */
export function describeOpeningStatus(
  raw: string | null | undefined,
  at: Date = new Date(),
): OpeningStatus {
  const trimmed = raw?.trim();
  if (!trimmed || /^(unknown|none)$/i.test(trimmed)) return { open: null, text: null };
  if (/^24\s*\/\s*7$/.test(trimmed)) return { open: true, text: 'Open 24 hours' };

  const weekly = buildWeeklyIntervals(trimmed);
  if (!weekly) return { open: null, text: null };

  const day = at.getDay();
  const minutes = at.getHours() * 60 + at.getMinutes();

  const today = weekly[day];
  // An interval that started yesterday and wraps past midnight (20:00-02:00)
  // still counts as open in the early hours of today.
  const prevDay = (day + 6) % 7;
  const wrapping = weekly[prevDay].find(
    (interval) => interval.start > interval.end && minutes < interval.end,
  );
  const current = today.find((interval) => contains(interval, minutes)) ?? wrapping;
  if (current) {
    if (current.start === 0 && current.end === 24 * 60) {
      return { open: true, text: 'Open 24 hours' };
    }
    return { open: true, text: `Open · Closes ${formatClockTime(current.end)}` };
  }

  // Closed now — find the next opening within the coming week.
  const laterToday = today
    .filter((interval) => interval.start > minutes)
    .sort((a, b) => a.start - b.start)[0];
  if (laterToday) {
    return { open: false, text: `Closed · Opens ${formatClockTime(laterToday.start)}` };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const nextDay = (day + offset) % 7;
    const upcoming = weekly[nextDay].slice().sort((a, b) => a.start - b.start)[0];
    if (!upcoming) continue;
    const time = formatClockTime(upcoming.start);
    const text =
      offset === 1 ? `Closed · Opens ${time}` : `Closed · Opens ${DAY_SHORT[nextDay]} ${time}`;
    return { open: false, text };
  }

  return { open: false, text: 'Closed' };
}
