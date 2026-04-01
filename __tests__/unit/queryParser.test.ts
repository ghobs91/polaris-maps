// queryParser is a pure module with no native/expo dependencies so no mocks needed

import {
  parseSearchQuery,
  levenshtein,
  fuzzyMatchBrand,
} from '../../src/services/search/queryParser';

// ---------------------------------------------------------------------------
// levenshtein
// ---------------------------------------------------------------------------

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('returns string length when other is empty', () => {
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', 'xyz')).toBe(3);
  });

  it('computes single-character edits', () => {
    expect(levenshtein('kitten', 'sitten')).toBe(1); // substitution
    expect(levenshtein('cat', 'cats')).toBe(1); // insertion
    expect(levenshtein('cats', 'cat')).toBe(1); // deletion
  });

  it('computes multi-character edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseSearchQuery
// ---------------------------------------------------------------------------

describe('parseSearchQuery', () => {
  it('resolves a simple category keyword', () => {
    const result = parseSearchQuery('coffee');
    expect(result.categories).toEqual(['cafe']);
    expect(result.coreQuery).toBe('coffee');
    expect(result.brand).toBeNull();
  });

  it('preserves the original query', () => {
    const result = parseSearchQuery('best pizza nearby');
    expect(result.originalQuery).toBe('best pizza nearby');
  });

  it('detects "near me" modifier', () => {
    const result = parseSearchQuery('coffee near me');
    expect(result.wantsNearMe).toBe(true);
    expect(result.categories).toEqual(['cafe']);
  });

  it('detects "open now" modifier', () => {
    const result = parseSearchQuery('restaurants open now');
    expect(result.wantsOpenNow).toBe(true);
  });

  it('detects quality modifiers', () => {
    const result = parseSearchQuery('best pizza nearby');
    expect(result.wantsQuality).toBe(true);
    expect(result.wantsNearMe).toBe(true);
    expect(result.cuisineHint).toBe('pizza');
  });

  it('detects cheap modifier', () => {
    const result = parseSearchQuery('cheap sushi');
    expect(result.wantsCheap).toBe(true);
    expect(result.cuisineHint).toBe('sushi');
  });

  it('detects brand names', () => {
    const result = parseSearchQuery('Starbucks');
    expect(result.brand).toBe('Starbucks');
    expect(result.isNameSearch).toBe(true);
  });

  it('detects multi-word brand names', () => {
    const result = parseSearchQuery('Taco Bell near me');
    expect(result.brand).toBe('Taco Bell');
    expect(result.wantsNearMe).toBe(true);
  });

  it('detects brand + cuisine hint together', () => {
    const result = parseSearchQuery('pizza hut');
    expect(result.brand).toBe('Pizza Hut');
    expect(result.cuisineHint).toBe('pizza');
  });

  it('extracts cuisine hints for food queries', () => {
    const result = parseSearchQuery('chinese food');
    expect(result.cuisineHint).toBe('chinese');
    expect(result.categories).toEqual(['restaurant']);
  });

  it('returns isNameSearch for non-category queries', () => {
    const result = parseSearchQuery('Whole Foods');
    expect(result.brand).toBe('Whole Foods Market');
    expect(result.isNameSearch).toBe(true);
  });

  it('handles empty and whitespace queries', () => {
    const result = parseSearchQuery('');
    expect(result.coreQuery).toBe('');
    expect(result.categories).toBeNull();
    expect(result.brand).toBeNull();
    expect(result.isNameSearch).toBe(false);
  });

  it('strips filler words from core query', () => {
    const result = parseSearchQuery('find me the best coffee nearby');
    expect(result.wantsQuality).toBe(true);
    expect(result.wantsNearMe).toBe(true);
    expect(result.categories).toEqual(['cafe']);
  });

  it('treats unknown terms as name search when no category matches', () => {
    const result = parseSearchQuery('Smith Tower');
    expect(result.categories).toBeNull();
    expect(result.isNameSearch).toBe(true);
    expect(result.brand).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fuzzyMatchBrand
// ---------------------------------------------------------------------------

describe('fuzzyMatchBrand', () => {
  it('exact match returns brand', () => {
    expect(fuzzyMatchBrand('starbucks')).toBe('Starbucks');
  });

  it('matches with 1-character typo for short brands', () => {
    expect(fuzzyMatchBrand('starbuks')).toBe('Starbucks');
  });

  it('matches with 2-character typo for longer brands', () => {
    expect(fuzzyMatchBrand('mcdonaods')).toBe("McDonald's");
  });

  it('returns null for totally unrelated strings', () => {
    expect(fuzzyMatchBrand('xyzqwerty')).toBeNull();
  });

  it('returns null for queries more than 3 words', () => {
    expect(fuzzyMatchBrand('a very long query that is not a brand')).toBeNull();
  });
});
