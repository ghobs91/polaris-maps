import { buildPlaceDetailUrl, getApplePlaceId } from '../../src/services/poi/placeDetailEmbed';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

// Mutable config values so tests can exercise configured/unconfigured states.
let mockUrl = '';
let mockToken = '';
jest.mock('../../src/constants/config', () => ({
  get mapkitJsEmbedToken() {
    return mockToken;
  },
  get mapkitPlaceDetailUrl() {
    return mockUrl;
  },
}));

const basePoi: OsmPoi = {
  id: 12345,
  lat: 40.7128,
  lng: -74.006,
  name: 'Test Cafe',
  type: 'amenity',
  subtype: 'cafe',
  tags: { name: 'Test Cafe', amenity: 'cafe' },
};

beforeEach(() => {
  mockUrl = 'https://polaris-maps-bsky-auth.netlify.app/place-detail.html';
  mockToken = 'eyJhbGciOiJFUzI1NiJ9.fake.jwt';
});

describe('getApplePlaceId', () => {
  it('returns the apple:place_id tag when present', () => {
    const poi = { ...basePoi, tags: { ...basePoi.tags, 'apple:place_id': 'I12345' } };
    expect(getApplePlaceId(poi)).toBe('I12345');
  });

  it('returns null when the tag is missing', () => {
    expect(getApplePlaceId(basePoi)).toBeNull();
  });
});

describe('buildPlaceDetailUrl', () => {
  it('returns null when no hosted page URL is configured', () => {
    mockUrl = '';
    expect(buildPlaceDetailUrl(basePoi)).toBeNull();
  });

  it('returns null when no embed token is configured', () => {
    mockToken = '';
    expect(buildPlaceDetailUrl(basePoi)).toBeNull();
  });

  it('builds a URL with name, coordinates, and theme query params', () => {
    const url = buildPlaceDetailUrl(basePoi, 'dark')!;
    expect(url).toContain('https://polaris-maps-bsky-auth.netlify.app/place-detail.html?');
    const query = new URL(url).searchParams;
    expect(query.get('name')).toBe('Test Cafe');
    expect(query.get('lat')).toBe('40.7128');
    expect(query.get('lng')).toBe('-74.006');
    expect(query.get('theme')).toBe('dark');
  });

  it('includes the Apple place id for deterministic lookup when available', () => {
    const poi = { ...basePoi, tags: { ...basePoi.tags, 'apple:place_id': 'I12345' } };
    const query = new URL(buildPlaceDetailUrl(poi)!).searchParams;
    expect(query.get('placeId')).toBe('I12345');
  });

  it('omits placeId when the POI has no apple:place_id tag', () => {
    const query = new URL(buildPlaceDetailUrl(basePoi)!).searchParams;
    expect(query.has('placeId')).toBe(false);
  });

  it('passes the token in the URL fragment, never the query string', () => {
    const url = buildPlaceDetailUrl(basePoi)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.has('token')).toBe(false);
    expect(parsed.hash).toBe(`#token=${encodeURIComponent(mockToken)}`);
  });

  it('omits the fragment when no token is configured', () => {
    mockToken = '';
    const url = buildPlaceDetailUrl(basePoi);
    expect(url).toBeNull();
  });

  it('includes a language override when provided', () => {
    const query = new URL(buildPlaceDetailUrl(basePoi, 'light', 'en-GB')!).searchParams;
    expect(query.get('lang')).toBe('en-GB');
  });
});
