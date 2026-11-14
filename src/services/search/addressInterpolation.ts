/**
 * Address interpolation.
 *
 * OSM rarely maps every house on a street: ranges are recorded with
 * `addr:interpolation` ways, and even dense areas miss numbers. The pack build
 * generates interpolated rows for those ranges, and this module covers the gaps
 * that remain at query time — "350 Fifth Ave" still resolves when the index
 * only knows 340 and 360.
 *
 * Interpolated results are always marked (`exact: false`) so callers can label
 * them as approximate rather than presenting a guessed position as surveyed.
 */

export interface AddressPoint {
  housenumber: string;
  lat: number;
  lng: number;
}

export interface InterpolatedAddress {
  /** The number that was asked for, as typed (lower-cased). */
  housenumber: string;
  lat: number;
  lng: number;
  /** Nearest known number below the target (or the target's own point). */
  lower: AddressPoint;
  /** Nearest known number above the target (or the target's own point). */
  upper: AddressPoint;
  /** True when an indexed point already carries this exact number. */
  exact: boolean;
}

/** Beyond the outermost known number, allow at most this share of the street's
 *  span as extrapolation before giving up. */
const MAX_EXTRAPOLATION_RATIO = 0.1;

/** Parse a house number into its numeric part plus any suffix ("12a" → 12/a). */
export function parseHouseNumber(value: string): { number: number; suffix: string } | null {
  const match = value.trim().match(/^(\d+)\s*([a-z]?)$/i);
  if (!match) return null;
  return { number: Number(match[1]), suffix: match[2].toLowerCase() };
}

/**
 * Resolve `target` against the known house numbers on one street.
 *
 * Returns null when the target cannot be parsed, when no point on the street
 * has a usable number, or when the target falls so far outside the known range
 * that an extrapolation would be a guess rather than an interpolation.
 */
export function interpolateAddressPoint(
  target: string,
  points: ReadonlyArray<AddressPoint>,
): InterpolatedAddress | null {
  const parsedTarget = parseHouseNumber(target);
  if (!parsedTarget) return null;

  const known: Array<AddressPoint & { number: number }> = [];
  for (const point of points) {
    const parsed = parseHouseNumber(point.housenumber);
    if (!parsed) continue;
    known.push({ ...point, number: parsed.number });
  }
  if (known.length === 0) return null;

  known.sort((a, b) => a.number - b.number);

  const exact = known.find((p) => p.number === parsedTarget.number);
  if (exact) {
    return {
      housenumber: target,
      lat: exact.lat,
      lng: exact.lng,
      lower: stripNumber(exact),
      upper: stripNumber(exact),
      exact: true,
    };
  }

  // Only a single numbered point on the street: it can't span a range.
  if (known.length === 1) return null;

  const first = known[0];
  const last = known[known.length - 1];
  const span = last.number - first.number;
  if (span <= 0) return null;

  const below = [...known].reverse().find((p) => p.number < parsedTarget.number);
  const above = known.find((p) => p.number > parsedTarget.number);

  if (!below || !above) {
    // Outside the mapped range. Interpolate from the nearest endpoint only
    // when the target is within a small extrapolation of the known span.
    const nearest = below ?? above!;
    const overshoot = Math.abs(parsedTarget.number - nearest.number);
    if (overshoot / span > MAX_EXTRAPOLATION_RATIO) return null;

    // `other` is the far endpoint of the known span, not the nearest one.
    const other = below ? first : last;
    if (other.number === nearest.number) return null;
    const t = (parsedTarget.number - other.number) / (nearest.number - other.number);
    return {
      housenumber: target,
      lat: lerp(other.lat, nearest.lat, t),
      lng: lerp(other.lng, nearest.lng, t),
      lower: stripNumber(below ? other : nearest),
      upper: stripNumber(below ? nearest : other),
      exact: false,
    };
  }

  const t = (parsedTarget.number - below.number) / (above.number - below.number);
  return {
    housenumber: target,
    lat: lerp(below.lat, above.lat, t),
    lng: lerp(below.lng, above.lng, t),
    lower: stripNumber(below),
    upper: stripNumber(above),
    exact: false,
  };
}

function stripNumber(point: AddressPoint & { number?: number }): AddressPoint {
  return { housenumber: point.housenumber, lat: point.lat, lng: point.lng };
}

function lerp(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return a + (b - a) * clamped;
}

/**
 * Numbers between two endpoints of an `addr:interpolation` way.
 *
 * `step` is 1 for `all`, 2 for `odd`/`even`. Numbers are aligned to the
 * endpoints' parity, so an odd range never emits even numbers.
 */
export function interpolateRange(
  startNumber: number,
  endNumber: number,
  step: number,
  limit: number = 200,
): number[] {
  const lo = Math.min(startNumber, endNumber);
  const hi = Math.max(startNumber, endNumber);
  const increment = step > 0 ? Math.floor(step) : 1;
  const out: number[] = [];
  for (let n = lo + increment; n < hi; n += increment) {
    out.push(n);
    if (out.length >= limit) break;
  }
  // Preserve the way's direction so generated points follow the geometry.
  return startNumber <= endNumber ? out : out.reverse();
}
