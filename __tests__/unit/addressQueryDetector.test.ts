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
  });

  it('returns false for non-address queries', () => {
    expect(isAddressQuery('coffee shop')).toBe(false);
    expect(isAddressQuery('Starbucks')).toBe(false);
    expect(isAddressQuery('pizza near me')).toBe(false);
    expect(isAddressQuery('gas station')).toBe(false);
    expect(isAddressQuery('Paris')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAddressQuery('123 MAIN STREET')).toBe(true);
    expect(isAddressQuery('123 Main AVENUE')).toBe(true);
    expect(isAddressQuery('highway 101')).toBe(true);
  });
});
