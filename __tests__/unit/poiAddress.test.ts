import {
  addressesMatch,
  assemblePoiAddress,
  distanceMeters,
  normalizeAddress,
  withinMeters,
} from '../../src/services/poi/poiAddress';

describe('assemblePoiAddress', () => {
  it('assembles housenumber + street + city/state/postcode from OSM tags', () => {
    expect(
      assemblePoiAddress({
        'addr:housenumber': '123',
        'addr:street': 'Main St',
        'addr:city': 'Springfield',
        'addr:state': 'IL',
        'addr:postcode': '62701',
      }),
    ).toBe('123 Main St, Springfield IL 62701');
  });

  it('uses street only when no housenumber is present', () => {
    expect(assemblePoiAddress({ 'addr:street': 'Main St', 'addr:city': 'Springfield' })).toBe(
      'Main St, Springfield',
    );
  });

  it('falls back to addr:full, then the enriched formatted address', () => {
    expect(assemblePoiAddress({ 'addr:full': '1 Infinite Loop, Cupertino' })).toBe(
      '1 Infinite Loop, Cupertino',
    );
    expect(assemblePoiAddress({}, '1 Infinite Loop, Cupertino')).toBe('1 Infinite Loop, Cupertino');
    expect(assemblePoiAddress({}, null)).toBeNull();
    expect(assemblePoiAddress(undefined, undefined)).toBeNull();
  });

  it('prefers structured tags over an enriched formatted address', () => {
    expect(assemblePoiAddress({ 'addr:street': 'Main St' }, 'Somewhere else')).toBe('Main St');
  });
});

describe('normalizeAddress / addressesMatch', () => {
  it('normalizes punctuation and case', () => {
    expect(normalizeAddress('123 Main St., Suite 4')).toBe('123 main st suite 4');
    expect(normalizeAddress(null)).toBe('');
  });

  it('matches equal and contained addresses', () => {
    expect(addressesMatch('123 Main St', '123 main street')).toBe(true);
    expect(addressesMatch('123 Main St, Springfield IL', 'Main St, Springfield')).toBe(true);
  });

  it('matches on shared house number + street token', () => {
    expect(addressesMatch('123 Main Street', '123 Main St')).toBe(true);
  });

  it('rejects different house numbers or streets', () => {
    expect(addressesMatch('123 Main St', '456 Main St')).toBe(false);
    expect(addressesMatch('123 Main St', '123 Oak Ave')).toBe(false);
    expect(addressesMatch('', '123 Main St')).toBe(false);
    expect(addressesMatch('Springfield', 'Shelbyville')).toBe(false);
  });
});

describe('distanceMeters / withinMeters', () => {
  it('computes ~0 for the same point', () => {
    expect(distanceMeters({ lat: 40.75, lng: -73.99 }, { lat: 40.75, lng: -73.99 })).toBeCloseTo(
      0,
      5,
    );
  });

  it('confirms proximity within a threshold', () => {
    const a = { lat: 40.75, lng: -73.99 };
    const near = { lat: 40.7502, lng: -73.9902 };
    const far = { lat: 40.76, lng: -74.0 };
    expect(withinMeters(near, a, 50)).toBe(true);
    expect(withinMeters(far, a, 50)).toBe(false);
  });
});
