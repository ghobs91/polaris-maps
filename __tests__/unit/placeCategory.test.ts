import { formatPlaceCategory } from '../../src/utils/placeCategory';

describe('formatPlaceCategory', () => {
  it('humanizes OSM subtypes', () => {
    expect(formatPlaceCategory('fast_food')).toBe('Fast Food');
    expect(formatPlaceCategory('coffee_shop')).toBe('Coffee Shop');
    expect(formatPlaceCategory('restaurant')).toBe('Restaurant');
  });

  it('maps Apple MapKit categories', () => {
    expect(formatPlaceCategory('MKPOICategoryCafe')).toBe('Café');
    expect(formatPlaceCategory('MKPOICategoryMovieTheater')).toBe('Cinema');
    expect(formatPlaceCategory('MKPOICategorySomethingNew')).toBe('Something New');
  });

  it('keeps acronyms readable', () => {
    expect(formatPlaceCategory('ev_charging')).toBe('EV Charger');
    expect(formatPlaceCategory('atm')).toBe('ATM');
    expect(formatPlaceCategory('bbq')).toBe('BBQ');
  });

  it('returns undefined for empty input', () => {
    expect(formatPlaceCategory(undefined)).toBeUndefined();
    expect(formatPlaceCategory('')).toBeUndefined();
    expect(formatPlaceCategory('   ')).toBeUndefined();
  });
});
