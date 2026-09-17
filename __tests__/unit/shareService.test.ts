import {
  buildPlaceLink,
  buildPlaceSchemeLink,
  parsePlaceLink,
} from '../../src/services/places/shareService';

describe('buildPlaceLink', () => {
  it('uses a canonical path when an id exists', () => {
    expect(buildPlaceLink({ canonicalId: 'abc123', lat: 1, lng: 2 })).toBe(
      'https://polarismaps.com/p/abc123',
    );
  });

  it('falls back to coordinates and name', () => {
    const link = buildPlaceLink({ lat: 40.7, lng: -74, name: 'Cafe A' });
    expect(link.startsWith('https://polarismaps.com/p?')).toBe(true);
    expect(link).toContain('lat=40.7');
    expect(link).toContain('name=Cafe+A');
  });

  it('builds an app-scheme fallback', () => {
    expect(buildPlaceSchemeLink({ canonicalId: 'x', lat: 1, lng: 2 })).toContain(
      'polaris-maps://place/x?',
    );
  });
});

describe('parsePlaceLink', () => {
  it('round-trips a canonical universal link', () => {
    const link = buildPlaceLink({ canonicalId: 'abc123', lat: 1, lng: 2 });
    expect(parsePlaceLink(link)).toEqual({
      canonicalId: 'abc123',
      name: undefined,
      lat: undefined,
      lng: undefined,
    });
  });

  it('round-trips a coordinate universal link', () => {
    const link = buildPlaceLink({ lat: 40.7128, lng: -74.006, name: 'Park' });
    const parsed = parsePlaceLink(link);
    expect(parsed?.lat).toBeCloseTo(40.7128, 4);
    expect(parsed?.lng).toBeCloseTo(-74.006, 4);
    expect(parsed?.name).toBe('Park');
  });

  it('parses the app-scheme link', () => {
    const parsed = parsePlaceLink(buildPlaceSchemeLink({ lat: 1, lng: 2, name: 'X' }));
    expect(parsed?.lat).toBe(1);
    expect(parsed?.lng).toBe(2);
    expect(parsed?.name).toBe('X');
  });

  it('rejects unrelated URLs and malformed input', () => {
    expect(parsePlaceLink('https://example.com/p/abc')).toBeNull();
    expect(parsePlaceLink('https://polarismaps.com/about')).toBeNull();
    expect(parsePlaceLink('not a url')).toBeNull();
  });
});
