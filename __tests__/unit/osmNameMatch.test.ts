import {
  buildOverpassNameRegex,
  damerauLevenshtein,
  nameSimilarity,
  nameTokens,
  normalizeOsmName,
  significantTokens,
} from '../../src/utils/osmNameMatch';

describe('normalizeOsmName', () => {
  it('folds diacritics, &, apostrophes and punctuation', () => {
    expect(normalizeOsmName("Café & Joe's")).toBe('cafe and joes');
    expect(normalizeOsmName('  The   Home   Depot ')).toBe('the home depot');
    expect(normalizeOsmName('M&M (Downtown)')).toBe('m and m downtown');
  });
});

describe('nameTokens / significantTokens', () => {
  it('expands name abbreviations', () => {
    expect(nameTokens('St. Mary')).toEqual(['saint', 'mary']);
  });

  it('drops core category words but keeps identity tokens', () => {
    expect(significantTokens('Starbucks Coffee')).toEqual(['starbucks']);
    expect(significantTokens('Central Park')).toEqual(['central']);
  });

  it('falls back to all tokens when a name is only core words', () => {
    expect(significantTokens('Cafe')).toEqual(['cafe']);
  });
});

describe('damerauLevenshtein', () => {
  it('counts substitutions, insertions and deletions', () => {
    expect(damerauLevenshtein('kitten', 'sitten')).toBe(1);
    expect(damerauLevenshtein('cat', 'cats')).toBe(1);
    expect(damerauLevenshtein('cats', 'cat')).toBe(1);
  });

  it('treats an adjacent transposition as one edit', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
  });
});

describe('nameSimilarity', () => {
  it('scores exact names as 1', () => {
    expect(nameSimilarity('Starbucks', 'Starbucks')).toBe(1);
  });

  it('ignores case, diacritics, apostrophes and &/and', () => {
    expect(nameSimilarity("McDonald's", 'McDonalds')).toBe(1);
    expect(nameSimilarity('Café Central', 'Cafe Central')).toBe(1);
    expect(nameSimilarity('Barnes & Noble', 'Barnes and Noble')).toBe(1);
  });

  it('matches a name against a longer name sharing its identity tokens', () => {
    expect(nameSimilarity('Starbucks', 'Starbucks Coffee')).toBe(1);
    expect(nameSimilarity("Joe's Best Cafe", 'Joes Best')).toBe(1);
  });

  it('matches abbreviated saint names', () => {
    expect(nameSimilarity("St. Mary's Hospital", 'Saint Marys Hospital')).toBe(1);
  });

  it('gives a high score to a near-miss name', () => {
    const sim = nameSimilarity('Golden Dragon', 'Golden Dragons');
    expect(sim).toBeGreaterThanOrEqual(0.9);
    expect(sim).toBeLessThan(0.97);
  });

  it('caps the score when core category words conflict', () => {
    expect(nameSimilarity('Central Park', 'Central Parking')).toBeLessThanOrEqual(0.8);
  });

  it('scores clearly different names low', () => {
    expect(nameSimilarity('Starbucks', 'Subway')).toBeLessThan(0.5);
  });
});

describe('buildOverpassNameRegex', () => {
  it('uses identity tokens', () => {
    expect(buildOverpassNameRegex('Starbucks Coffee')).toBe('starbucks');
    expect(buildOverpassNameRegex('The Home Depot')).toBe('home|depot');
  });

  it('falls back to the whole normalized name for short names', () => {
    expect(buildOverpassNameRegex('BP')).toBe('bp');
  });

  it('returns an empty string for empty input', () => {
    expect(buildOverpassNameRegex('   ')).toBe('');
  });
});
