/**
 * Region Overture importer.
 *
 * Guards the offline viewport-POI ingest path: a missing extract is a no-op, an
 * oversized extract is refused (it would OOM the whole-document JSON parse),
 * and a valid FeatureCollection is delegated to the upsert.
 */

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));
jest.mock('../../src/services/poi/overtureFetcher', () => ({
  importOverturePlacesFromGeoJSON: jest.fn(),
}));

import { importRegionOverturePlaces } from '../../src/services/regions/overtureImporter';
import { importOverturePlacesFromGeoJSON } from '../../src/services/poi/overtureFetcher';

const fs = jest.requireMock('expo-file-system/legacy') as {
  getInfoAsync: jest.Mock;
  readAsStringAsync: jest.Mock;
};
const importFromGeoJSON = importOverturePlacesFromGeoJSON as jest.Mock;

const DIR = 'file:///regions/us-new-york/';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('importRegionOverturePlaces', () => {
  it('returns 0 without reading when the extract is absent', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: false });

    await expect(importRegionOverturePlaces(DIR)).resolves.toBe(0);
    expect(fs.readAsStringAsync).not.toHaveBeenCalled();
    expect(importFromGeoJSON).not.toHaveBeenCalled();
  });

  it('refuses an oversized extract instead of parsing it', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: true, size: 65 * 1024 * 1024 });

    await expect(importRegionOverturePlaces(DIR)).resolves.toBe(0);
    expect(fs.readAsStringAsync).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('parses a valid FeatureCollection and delegates to the upsert', async () => {
    const geojson = { type: 'FeatureCollection', features: [] };
    fs.getInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify(geojson));
    importFromGeoJSON.mockResolvedValue(3);

    await expect(importRegionOverturePlaces(DIR)).resolves.toBe(3);
    expect(importFromGeoJSON).toHaveBeenCalledWith(geojson);
  });

  it('returns 0 for a non-FeatureCollection payload', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify({ type: 'Feature' }));

    await expect(importRegionOverturePlaces(DIR)).resolves.toBe(0);
    expect(importFromGeoJSON).not.toHaveBeenCalled();
  });
});
