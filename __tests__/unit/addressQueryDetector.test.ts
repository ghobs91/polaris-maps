import { isAddressQuery } from '../../src/services/search/queryParser';

describe('isAddressQuery', () => {
  it('returns true for queries containing street abbreviations', () => {
    expect(isAddressQuery('123 Main St Apt 4')).toBe(true);
    expect(isAddressQuery('500 5th Ave Suite 3')).toBe(true);
    expect(isAddressQuery('10 Elm Blvd Suite 1')).toBe(true);
    expect(isAddressQuery('42 Oak Rd North')).toBe(true);
    expect(isAddressQuery('99 Pine Dr West')).toBe(true);
    expect(isAddressQuery('7 Maple Ln East')).toBe(true);
    expect(isAddressQuery('11 Park Ct Apt 2')).toBe(true);
    expect(isAddressQuery('200 River Pkwy South')).toBe(true);
    // Newly added abbreviations
    expect(isAddressQuery('1000 Broadway')).toBe(true);
    expect(isAddressQuery('50 Oak Cir')).toBe(true);
    expect(isAddressQuery('742 Evergreen Ter')).toBe(true);
    expect(isAddressQuery('15 Mountain Trl')).toBe(true);
    expect(isAddressQuery('8 Garden Aly')).toBe(true);
    expect(isAddressQuery('22 Lake Cv')).toBe(true);
    expect(isAddressQuery('400 Main Sq')).toBe(true);
    expect(isAddressQuery('12 Beach Walk')).toBe(true);
    expect(isAddressQuery('3 Forest Path')).toBe(true);
  });

  it('returns true for queries containing full street words', () => {
    expect(isAddressQuery('123 Main Street')).toBe(true);
    expect(isAddressQuery('Broadway Avenue')).toBe(true);
    expect(isAddressQuery('Central Boulevard')).toBe(true);
    expect(isAddressQuery('Country Road 5')).toBe(true);
    expect(isAddressQuery('Sunset Drive')).toBe(true);
    expect(isAddressQuery('Willow Lane')).toBe(true);
    expect(isAddressQuery('Rose Court')).toBe(true);
    expect(isAddressQuery('Route 66 Highway')).toBe(true);
    expect(isAddressQuery('Interstate Hwy 95')).toBe(true);
    // Newly added full words
    expect(isAddressQuery('123 Park Way')).toBe(true);
    expect(isAddressQuery('50 Oak Circle')).toBe(true);
    expect(isAddressQuery('742 Evergreen Terrace')).toBe(true);
    expect(isAddressQuery('15 Mountain Trail')).toBe(true);
    expect(isAddressQuery('8 Garden Alley')).toBe(true);
    expect(isAddressQuery('22 Lake Cove')).toBe(true);
    expect(isAddressQuery('400 Market Square')).toBe(true);
    expect(isAddressQuery('3 Forest Path')).toBe(true);
    expect(isAddressQuery('7 Ridge Loop')).toBe(true);
    expect(isAddressQuery('1 Mountain Pass')).toBe(true);
  });

  it('returns true for leading-number + city/state pattern (comma)', () => {
    expect(isAddressQuery('314 Columbus, OH')).toBe(true);
    expect(isAddressQuery('12345, Springfield')).toBe(true);
    expect(isAddressQuery('90210, Beverly Hills, CA')).toBe(true);
  });

  it('returns true for leading house number + word ending with street suffix', () => {
    // "way" embedded in street name — no standalone token
    expect(isAddressQuery('1000 Broadway')).toBe(true);
    expect(isAddressQuery('1 Gateway')).toBe(true);
    // Other embedded suffixes
    expect(isAddressQuery('100 Market Square')).toBe(true);
    expect(isAddressQuery('742 Evergreen Terrace')).toBe(true);
    expect(isAddressQuery('15 Mountain Trail')).toBe(true);
    expect(isAddressQuery('22 Lake Cove')).toBe(true);
  });

  it('returns false for non-address queries', () => {
    expect(isAddressQuery('coffee shop')).toBe(false);
    expect(isAddressQuery('Starbucks')).toBe(false);
    expect(isAddressQuery('pizza near me')).toBe(false);
    expect(isAddressQuery('gas station')).toBe(false);
    expect(isAddressQuery('Paris')).toBe(false);
    // Words ending in "way" that aren't addresses
    expect(isAddressQuery('doorway')).toBe(false);
    expect(isAddressQuery('hallway')).toBe(false);
    expect(isAddressQuery('freeway exit')).toBe(false);
    // Leading numbers without address context
    expect(isAddressQuery('24 hour fitness')).toBe(false);
    expect(isAddressQuery('2 bedroom apartment')).toBe(false);
    expect(isAddressQuery('10 best restaurants')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAddressQuery('123 MAIN STREET')).toBe(true);
    expect(isAddressQuery('123 Main AVENUE')).toBe(true);
    expect(isAddressQuery('highway 101')).toBe(true);
    expect(isAddressQuery('1000 BROADWAY')).toBe(true);
    expect(isAddressQuery('742 EVERGREEN TERRACE')).toBe(true);
  });
});
