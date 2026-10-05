import {
  GEO_MATCH_METERS,
  matchIdentity,
  pickBestCandidate,
} from '../../src/services/poi/identity';
import type {
  ExternalRatingQuery,
  RatingSearchCandidate,
} from '../../src/services/poi/externalRatings/types';

const QUERY: ExternalRatingQuery = {
  name: 'Foo Bar',
  lat: 40.75,
  lng: -73.99,
  address: '123 Main St, New York NY',
};

function candidate(overrides: Partial<RatingSearchCandidate>): RatingSearchCandidate {
  return {
    url: 'https://example.com/biz/foo',
    name: 'Foo Bar',
    address: null,
    geo: null,
    ...overrides,
  };
}

describe('matchIdentity', () => {
  it('accepts a name + address match', () => {
    expect(matchIdentity(candidate({ address: '123 Main St, New York' }), QUERY)).toBe(true);
  });

  it('accepts a name + nearby geo match', () => {
    expect(matchIdentity(candidate({ geo: { lat: 40.7501, lng: -73.9901 } }), QUERY)).toBe(true);
  });

  it('rejects a chain branch with a matching name but wrong address/geo', () => {
    expect(matchIdentity(candidate({ address: '500 Broadway, Brooklyn NY' }), QUERY)).toBe(false);
    expect(matchIdentity(candidate({ geo: { lat: 40.9, lng: -74.1 } }), QUERY)).toBe(false);
  });

  it('rejects a name mismatch even when the address matches', () => {
    expect(
      matchIdentity(candidate({ name: 'Different Place', address: '123 Main St' }), QUERY),
    ).toBe(false);
  });

  it('rejects a name-only candidate with no confirmation signal', () => {
    expect(matchIdentity(candidate({}), QUERY)).toBe(false);
  });
});

describe('pickBestCandidate', () => {
  it('returns the first confident match and skips weaker ones', () => {
    const candidates: RatingSearchCandidate[] = [
      candidate({ name: 'Foo Bar', address: '500 Broadway, Brooklyn NY' }),
      candidate({ name: 'Foo Bar', geo: { lat: 40.75, lng: -73.99 } }),
    ];
    const best = pickBestCandidate(candidates, QUERY);
    expect(best).toBe(candidates[1]);
  });

  it('returns null when nothing matches', () => {
    expect(pickBestCandidate([candidate({ geo: { lat: 1, lng: 1 } })], QUERY)).toBeNull();
  });

  it('exposes a sane geo threshold', () => {
    expect(GEO_MATCH_METERS).toBe(50);
  });
});
