import {
  clearWebsiteRedirectSyncState,
  syncOsmWebsiteFromRedirect,
} from '../../src/services/osm/websiteRedirectService';
import { fetchOsmNode, submitOsmNodeEdit } from '../../src/services/osm/osmEditService';
import { findOsmPlaceMatch } from '../../src/services/poi/osmFetcher';

jest.mock('../../src/services/osm/osmEditService', () => ({
  fetchOsmNode: jest.fn(),
  submitOsmNodeEdit: jest.fn(),
}));

jest.mock('../../src/services/poi/osmFetcher', () => ({
  findOsmPlaceMatch: jest.fn(),
}));

const mockFetchOsmNode = fetchOsmNode as jest.MockedFunction<typeof fetchOsmNode>;
const mockSubmit = submitOsmNodeEdit as jest.MockedFunction<typeof submitOsmNodeEdit>;
const mockFindMatch = findOsmPlaceMatch as jest.MockedFunction<typeof findOsmPlaceMatch>;

const nodePoi = {
  id: 123,
  lat: 40.8,
  lng: -73.4,
  name: 'Smoked Barn',
  tags: { website: 'https://smokedbarn.com/' },
};

beforeEach(() => {
  jest.clearAllMocks();
  clearWebsiteRedirectSyncState();
  mockSubmit.mockResolvedValue({ changesetId: 1, newVersion: 2 });
});

describe('syncOsmWebsiteFromRedirect', () => {
  it('skips when the user cannot edit', async () => {
    await expect(
      syncOsmWebsiteFromRedirect({
        poi: nodePoi,
        taggedWebsite: 'https://smokedbarn.com/',
        finalUrl: 'https://smokedbarnofperu.com/',
        accessToken: 'tok',
        canEdit: false,
      }),
    ).resolves.toBe('skipped');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('skips a same-host (www/apex) move', async () => {
    await expect(
      syncOsmWebsiteFromRedirect({
        poi: nodePoi,
        taggedWebsite: 'https://www.smokedbarn.com/',
        finalUrl: 'https://smokedbarn.com/',
        accessToken: 'tok',
        canEdit: true,
      }),
    ).resolves.toBe('skipped');
  });

  it('skips a deep-link (non-root) redirect', async () => {
    await expect(
      syncOsmWebsiteFromRedirect({
        poi: nodePoi,
        taggedWebsite: 'https://smokedbarn.com/',
        finalUrl: 'https://smokedbarnofperu.com/menu',
        accessToken: 'tok',
        canEdit: true,
      }),
    ).resolves.toBe('skipped');
  });

  it('updates the website tag when the node still carries the old URL', async () => {
    mockFetchOsmNode.mockResolvedValue({
      id: 123,
      lat: 40.8,
      lon: -73.4,
      version: 5,
      tags: { website: 'https://smokedbarn.com/', name: 'Smoked Barn' },
    });

    await expect(
      syncOsmWebsiteFromRedirect({
        poi: nodePoi,
        taggedWebsite: 'https://smokedbarn.com/',
        finalUrl: 'https://smokedbarnofperu.com/',
        accessToken: 'tok',
        canEdit: true,
      }),
    ).resolves.toBe('updated');

    expect(mockSubmit).toHaveBeenCalledWith(
      'tok',
      123,
      { website: 'https://smokedbarnofperu.com' },
      expect.stringContaining('smokedbarnofperu.com'),
    );
  });

  it('never clobbers a website someone else already corrected', async () => {
    mockFetchOsmNode.mockResolvedValue({
      id: 123,
      lat: 40.8,
      lon: -73.4,
      version: 6,
      tags: { website: 'https://somethingelse.com/' },
    });

    await expect(
      syncOsmWebsiteFromRedirect({
        poi: nodePoi,
        taggedWebsite: 'https://smokedbarn.com/',
        finalUrl: 'https://smokedbarnofperu.com/',
        accessToken: 'tok',
        canEdit: true,
      }),
    ).resolves.toBe('skipped');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('resolves the OSM node for a synthetic (non-OSM) place', async () => {
    mockFindMatch.mockResolvedValue({ type: 'node', id: 999 });
    mockFetchOsmNode.mockResolvedValue({
      id: 999,
      lat: 40.8,
      lon: -73.4,
      version: 3,
      tags: { 'contact:website': 'https://smokedbarn.com/' },
    });

    await expect(
      syncOsmWebsiteFromRedirect({
        poi: { ...nodePoi, id: -42 },
        taggedWebsite: 'https://smokedbarn.com/',
        finalUrl: 'https://smokedbarnofperu.com/',
        accessToken: 'tok',
        canEdit: true,
      }),
    ).resolves.toBe('updated');

    expect(mockFindMatch).toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalledWith(
      'tok',
      999,
      { 'contact:website': 'https://smokedbarnofperu.com' },
      expect.any(String),
    );
  });

  it('only edits a node once per session', async () => {
    mockFetchOsmNode.mockResolvedValue({
      id: 123,
      lat: 40.8,
      lon: -73.4,
      version: 5,
      tags: { website: 'https://smokedbarn.com/' },
    });
    const params = {
      poi: nodePoi,
      taggedWebsite: 'https://smokedbarn.com/',
      finalUrl: 'https://smokedbarnofperu.com/',
      accessToken: 'tok',
      canEdit: true,
    } as const;

    await expect(syncOsmWebsiteFromRedirect(params)).resolves.toBe('updated');
    await expect(syncOsmWebsiteFromRedirect(params)).resolves.toBe('skipped');
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});
