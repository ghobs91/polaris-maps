import {
  resolveSearchCategories,
  categoryToOverpassTags,
  extractCuisineHint,
} from '../../src/services/poi/categoryResolver';

// ---------------------------------------------------------------------------
// resolveSearchCategories
// ---------------------------------------------------------------------------

describe('resolveSearchCategories', () => {
  it('resolves "coffeeshops" to cafe category', () => {
    expect(resolveSearchCategories('coffeeshops')).toEqual(['cafe']);
  });

  it('resolves "coffee" to cafe category', () => {
    expect(resolveSearchCategories('coffee')).toEqual(['cafe']);
  });

  it('resolves "coffee shop" (with space) to cafe category', () => {
    expect(resolveSearchCategories('coffee shop')).toEqual(['cafe']);
  });

  it('resolves "restaurants" to restaurant category', () => {
    expect(resolveSearchCategories('restaurants')).toEqual(['restaurant']);
  });

  it('resolves "gas station" to gas_station category', () => {
    expect(resolveSearchCategories('gas station')).toEqual(['gas_station']);
  });

  it('resolves "food" to multiple categories', () => {
    const result = resolveSearchCategories('food');
    expect(result).toEqual(['restaurant', 'fast_food', 'cafe', 'bakery']);
  });

  it('resolves "grocery" to grocery and supermarket', () => {
    const result = resolveSearchCategories('grocery');
    expect(result).toEqual(['grocery', 'supermarket']);
  });

  it('resolves "gym" to gym category', () => {
    expect(resolveSearchCategories('gym')).toEqual(['gym']);
  });

  it('resolves "ev charging" to ev_charging category', () => {
    expect(resolveSearchCategories('ev charging')).toEqual(['ev_charging']);
  });

  it('is case insensitive', () => {
    expect(resolveSearchCategories('COFFEE')).toEqual(['cafe']);
    expect(resolveSearchCategories('Restaurant')).toEqual(['restaurant']);
    expect(resolveSearchCategories('GAS STATION')).toEqual(['gas_station']);
  });

  it('returns null for unknown queries', () => {
    expect(resolveSearchCategories('xyzzy')).toBeNull();
    expect(resolveSearchCategories('asdf1234')).toBeNull();
  });

  it('returns null for empty/whitespace queries', () => {
    expect(resolveSearchCategories('')).toBeNull();
    expect(resolveSearchCategories('   ')).toBeNull();
  });

  it('resolves "chinese food" to restaurant category', () => {
    expect(resolveSearchCategories('chinese food')).toEqual(['restaurant']);
  });

  it('resolves "thai restaurant" to restaurant category', () => {
    expect(resolveSearchCategories('thai restaurant')).toEqual(['restaurant']);
  });

  it('resolves "ramen" to restaurant category', () => {
    expect(resolveSearchCategories('ramen')).toEqual(['restaurant']);
  });

  it('handles plural forms via trailing s removal', () => {
    // "bars" → strip s → "bar"
    expect(resolveSearchCategories('bars')).toEqual(['bar']);
  });

  it('resolves multi-word queries by matching individual words', () => {
    // "best coffee nearby" → word "coffee" matches cafe
    const result = resolveSearchCategories('best coffee nearby');
    expect(result).toEqual(['cafe']);
  });

  it('resolves queries with multiple matching words', () => {
    // "coffee and food" → "coffee" → cafe, "food" → restaurant, fast_food, cafe, bakery
    const result = resolveSearchCategories('coffee and food');
    expect(result).toContain('cafe');
    expect(result).toContain('restaurant');
  });
});

// ---------------------------------------------------------------------------
// categoryToOverpassTags
// ---------------------------------------------------------------------------

describe('categoryToOverpassTags', () => {
  it('returns correct tags for cafe', () => {
    const tags = categoryToOverpassTags('cafe');
    expect(tags).toEqual([
      ['amenity', 'cafe'],
      ['shop', 'coffee'],
    ]);
  });

  it('returns correct tags for restaurant', () => {
    const tags = categoryToOverpassTags('restaurant');
    expect(tags).toEqual([['amenity', 'restaurant']]);
  });

  it('returns correct tags for bar', () => {
    const tags = categoryToOverpassTags('bar');
    expect(tags).toEqual([
      ['amenity', 'bar'],
      ['amenity', 'pub'],
    ]);
  });

  it('returns correct tags for gas_station', () => {
    const tags = categoryToOverpassTags('gas_station');
    expect(tags).toEqual([['amenity', 'fuel']]);
  });

  it('returns correct tags for ev_charging', () => {
    const tags = categoryToOverpassTags('ev_charging');
    expect(tags).toEqual([['amenity', 'charging_station']]);
  });

  it('returns fallback for unknown categories', () => {
    const tags = categoryToOverpassTags('other');
    // Falls through to the default: ['amenity', category]
    expect(tags).toEqual([['amenity', 'other']]);
  });
});

// ---------------------------------------------------------------------------
// extractCuisineHint
// ---------------------------------------------------------------------------

describe('extractCuisineHint', () => {
  it('extracts "chinese" from "chinese food"', () => {
    expect(extractCuisineHint('chinese food')).toBe('chinese');
  });

  it('extracts "chinese" from "chinese restaurant"', () => {
    expect(extractCuisineHint('chinese restaurant')).toBe('chinese');
  });

  it('extracts "mexican" from "mexican food"', () => {
    expect(extractCuisineHint('mexican food')).toBe('mexican');
  });

  it('extracts "sushi" from "sushi"', () => {
    expect(extractCuisineHint('sushi')).toBe('sushi');
  });

  it('returns null for generic queries', () => {
    expect(extractCuisineHint('food')).toBeNull();
    expect(extractCuisineHint('restaurant')).toBeNull();
    expect(extractCuisineHint('coffee')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractCuisineHint('Chinese Food')).toBe('chinese');
    expect(extractCuisineHint('THAI')).toBe('thai');
  });

  it('extracts cuisine from "middle eastern food"', () => {
    expect(extractCuisineHint('middle eastern food')).toBe('middle_eastern');
  });
});
