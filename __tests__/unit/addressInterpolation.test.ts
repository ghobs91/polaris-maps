/**
 * Address interpolation: query-time gaps left by the pack's `addr:interpolation`
 * build, plus the range generator shared with the pack builder.
 */

import {
  interpolateAddressPoint,
  interpolateRange,
  parseHouseNumber,
  type AddressPoint,
} from '../../src/services/search/addressInterpolation';

const street: AddressPoint[] = [
  { housenumber: '100', lat: 40.0, lng: -74.0 },
  { housenumber: '200', lat: 40.0, lng: -73.9 },
];

describe('parseHouseNumber', () => {
  it('parses plain and suffixed numbers', () => {
    expect(parseHouseNumber('350')).toEqual({ number: 350, suffix: '' });
    expect(parseHouseNumber('12a')).toEqual({ number: 12, suffix: 'a' });
    expect(parseHouseNumber(' 7 B ')).toEqual({ number: 7, suffix: 'b' });
  });

  it('rejects non-numeric house numbers', () => {
    expect(parseHouseNumber('Main')).toBeNull();
    expect(parseHouseNumber('')).toBeNull();
    expect(parseHouseNumber('12-14')).toBeNull();
  });
});

describe('interpolateAddressPoint', () => {
  it('returns the indexed point unchanged for an exact number', () => {
    const result = interpolateAddressPoint('100', street);
    expect(result).toMatchObject({ exact: true, lat: 40.0, lng: -74.0, housenumber: '100' });
  });

  it('places a missing number proportionally between its neighbours', () => {
    // 150 is halfway between 100 and 200 → halfway along the segment.
    const result = interpolateAddressPoint('150', street);
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
    expect(result!.lng).toBeCloseTo(-73.95, 6);
    expect(result!.lower.housenumber).toBe('100');
    expect(result!.upper.housenumber).toBe('200');
  });

  it('is directional: a quarter of the way in lands a quarter along', () => {
    const result = interpolateAddressPoint('125', street);
    expect(result!.lng).toBeCloseTo(-73.975, 6);
  });

  it('interpolates across a range smaller than the gap', () => {
    const dense: AddressPoint[] = [
      { housenumber: '340', lat: 40.0, lng: -74.0 },
      { housenumber: '360', lat: 40.0, lng: -73.99 },
    ];
    const result = interpolateAddressPoint('350', dense);
    expect(result!.lng).toBeCloseTo(-73.995, 6);
  });

  it('snaps a number just past the mapped range to its nearest endpoint', () => {
    // 205 is 5% past 200 on a span of 100 → inside the extrapolation budget, so
    // it resolves at the end of the street rather than being invented further
    // along. It is still reported as approximate.
    const result = interpolateAddressPoint('205', [...street].reverse());
    expect(result).not.toBeNull();
    expect(result!.lng).toBeCloseTo(-73.9, 6);
    expect(result!.exact).toBe(false);
  });

  it('refuses to extrapolate far past the mapped range', () => {
    expect(interpolateAddressPoint('900', street)).toBeNull();
  });

  it('returns null with fewer than two numbered points', () => {
    expect(interpolateAddressPoint('150', [street[0]])).toBeNull();
    expect(interpolateAddressPoint('150', [])).toBeNull();
  });

  it('treats a suffixed number as its numeric position', () => {
    // "150A" sits at the same point as "150"; the suffix only matters for names.
    expect(interpolateAddressPoint('150A', street)!.lng).toBeCloseTo(-73.95, 6);
  });

  it('returns null when the target has no usable number', () => {
    expect(interpolateAddressPoint('Main Street', street)).toBeNull();
  });

  it('ignores points whose house numbers do not parse', () => {
    const mixed: AddressPoint[] = [...street, { housenumber: 'N/A', lat: 40.5, lng: -73.0 }];
    expect(interpolateAddressPoint('150', mixed)!.lng).toBeCloseTo(-73.95, 6);
  });

  it('handles a reversed input order', () => {
    const result = interpolateAddressPoint('150', [...street].reverse());
    expect(result!.lower.housenumber).toBe('100');
    expect(result!.upper.housenumber).toBe('200');
  });
});

describe('interpolateRange (pack build)', () => {
  it('fills every number between the endpoints for addr:interpolation=all', () => {
    expect(interpolateRange(1, 5, 1)).toEqual([2, 3, 4]);
  });

  it('keeps parity for odd ranges', () => {
    expect(interpolateRange(1, 9, 2)).toEqual([3, 5, 7]);
  });

  it('keeps parity for even ranges', () => {
    expect(interpolateRange(2, 10, 2)).toEqual([4, 6, 8]);
  });

  it('preserves the way direction', () => {
    expect(interpolateRange(9, 1, 2)).toEqual([7, 5, 3]);
  });

  it('caps absurd ranges', () => {
    expect(interpolateRange(1, 100000, 1, 10)).toHaveLength(10);
  });

  it('returns nothing when the endpoints touch', () => {
    expect(interpolateRange(5, 5, 1)).toEqual([]);
  });
});
