import {
  categoryCompatibility,
  classifyOsmMatch,
  derivePrimaryTag,
  matchRadiusMeters,
  type OsmCandidate,
} from '../../src/services/poi/osmMatchScorer';

const LAT = 40.748;
const LNG = -73.985;

function candidate(tags: Record<string, string>, lat = LAT, lng = LNG): OsmCandidate {
  return { type: 'node', id: 1, lat, lng, tags };
}

function target(name: string, tags: Record<string, string>) {
  return { name, lat: LAT, lng: LNG, tags };
}

describe('derivePrimaryTag', () => {
  it('returns the first known primary key', () => {
    expect(derivePrimaryTag({ shop: 'bakery', amenity: 'cafe' })).toEqual({
      type: 'amenity',
      value: 'cafe',
    });
    expect(derivePrimaryTag({ name: 'X' })).toBeNull();
  });
});

describe('categoryCompatibility', () => {
  it('classifies exact / group / mismatch / unknown', () => {
    expect(
      categoryCompatibility({ type: 'amenity', value: 'cafe' }, { type: 'amenity', value: 'cafe' }),
    ).toBe('exact');
    expect(
      categoryCompatibility(
        { type: 'amenity', value: 'restaurant' },
        { type: 'amenity', value: 'fast_food' },
      ),
    ).toBe('group');
    expect(
      categoryCompatibility({ type: 'amenity', value: 'cafe' }, { type: 'shop', value: 'clothes' }),
    ).toBe('mismatch');
    expect(categoryCompatibility({ type: 'amenity', value: 'cafe' }, null)).toBe('unknown');
  });
});

describe('matchRadiusMeters', () => {
  it('uses a wider radius for large features and a tighter one for tiny ones', () => {
    expect(matchRadiusMeters({ amenity: 'cafe' })).toBe(120);
    expect(matchRadiusMeters({ leisure: 'park' })).toBe(250);
    expect(matchRadiusMeters({ amenity: 'atm' })).toBe(80);
  });
});

describe('classifyOsmMatch', () => {
  it('matches an identical name and category at the same spot', () => {
    const result = classifyOsmMatch(
      target('Starbucks', { amenity: 'cafe' }),
      candidate({ name: 'Starbucks', amenity: 'cafe' }),
    );
    expect(result.match).toBe(true);
  });

  it('matches a fuzzy name variant with a compatible category', () => {
    const result = classifyOsmMatch(
      target('Starbucks', { amenity: 'cafe' }),
      candidate({ name: 'Starbucks Coffee', amenity: 'cafe' }),
    );
    expect(result.match).toBe(true);
  });

  it('does not match a different name nearby', () => {
    const result = classifyOsmMatch(
      target('Starbucks', { amenity: 'cafe' }),
      candidate({ name: 'Subway', amenity: 'fast_food' }),
    );
    expect(result.match).toBe(false);
  });

  it('does not match a same-name candidate outside the radius', () => {
    const result = classifyOsmMatch(
      target('Starbucks', { amenity: 'cafe' }),
      candidate({ name: 'Starbucks', amenity: 'cafe' }, 40.8005, LNG),
    );
    expect(result.match).toBe(false);
    expect(result.reasons).toContain('out-of-range');
  });

  it('does not match a similar name when the category conflicts', () => {
    const result = classifyOsmMatch(
      target('Golden Dragon', { amenity: 'restaurant' }),
      candidate({ name: 'Golden Dragons', shop: 'hardware' }),
    );
    expect(result.match).toBe(false);
  });

  it('matches a similar name in the same category group when very close', () => {
    const result = classifyOsmMatch(
      target('Golden Dragon', { amenity: 'restaurant' }),
      candidate({ name: 'Golden Dragons', amenity: 'fast_food' }),
    );
    expect(result.match).toBe(true);
  });

  it('matches on brand:wikidata even when the names differ', () => {
    const result = classifyOsmMatch(
      target("Joe's Coffee", { amenity: 'cafe', 'brand:wikidata': 'q37158' }),
      candidate({ name: 'Bucks Coffee', amenity: 'cafe', 'brand:wikidata': 'Q37158' }),
    );
    expect(result.match).toBe(true);
    expect(result.reasons).toContain('brand:wikidata');
  });

  it('matches on a normalized phone number', () => {
    const result = classifyOsmMatch(
      target('Corner Cafe', { amenity: 'cafe', phone: '+1 (555) 123-4567' }),
      candidate({ name: 'The Corner', amenity: 'cafe', 'contact:phone': '555-123-4567' }),
    );
    expect(result.match).toBe(true);
    expect(result.reasons).toContain('phone');
  });

  it('matches on a normalized website (www + trailing slash)', () => {
    const result = classifyOsmMatch(
      target('Corner Cafe', { amenity: 'cafe', website: 'https://www.example.com/' }),
      candidate({ name: 'Corner', amenity: 'cafe', website: 'http://example.com' }),
    );
    expect(result.match).toBe(true);
    expect(result.reasons).toContain('website');
  });

  it('does not match when the candidate is unrelated', () => {
    const result = classifyOsmMatch(
      target('Central Park', { leisure: 'park' }),
      candidate({ name: 'Central Parking', amenity: 'parking' }),
    );
    expect(result.match).toBe(false);
  });
});
