/**
 * Minimal opening-hours evaluation for the "open now" search intent.
 *
 * Covers the common OSM syntax shapes found in place data:
 *   "24/7", "Mo-Fr 09:00-17:00", "Sa,Su 10:00-16:00; Mo-Fr 08:00-20:00",
 *   overnight ranges ("20:00-02:00").
 *
 * Returns `null` for missing or unparseable hours so unknown data never
 * filters a result out (see specs/search-ranking).
 *
 * Decision: a full `opening_hours` parser dependency is not justified yet —
 * this subset covers the fixture corpus. Revisit if real data shows
 * coverage gaps (design.md, ranking v2).
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

const RULE_RE = /^([A-Za-z,\- ]+?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

/** True when `at` falls inside parseable opening hours; null when unknown. */
export function parseOpenNow(
  hours: string | null | undefined,
  at: Date = new Date(),
): boolean | null {
  if (!hours) return null;
  const raw = hours.trim();
  if (!raw || /^(unknown|none)$/i.test(raw)) return null;
  if (/^24\s*\/\s*7$/.test(raw)) return true;

  const day = at.getDay();
  const minutes = at.getHours() * 60 + at.getMinutes();
  let sawRule = false;
  let open = false;

  for (const ruleRaw of raw.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule || /^(closed|off)$/i.test(rule)) continue;
    const match = rule.match(RULE_RE);
    if (!match) continue;
    // Parseable hours exist — a day not covered by any rule is closed.
    sawRule = true;
    const [, days, startHour, startMin, endHour, endMin] = match;
    if (!dayMatches(days, day)) continue;

    const start = Number(startHour) * 60 + Number(startMin);
    const end = Number(endHour) * 60 + Number(endMin);
    if (start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end) {
      open = true;
    }
  }

  return sawRule ? open : null;
}

function dayMatches(spec: string, day: number): boolean {
  for (const part of spec.split(',')) {
    const range = part
      .trim()
      .split('-')
      .map((s) => s.trim().slice(0, 2).toLowerCase());
    const from = DAY_INDEX[range[0]];
    const to = DAY_INDEX[range[1] ?? range[0]];
    if (from == null || to == null) continue;
    if (from <= to ? day >= from && day <= to : day >= from || day <= to) return true;
  }
  return false;
}
