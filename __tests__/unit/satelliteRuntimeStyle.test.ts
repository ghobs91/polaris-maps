/**
 * Tests for the runtime satellite layer manager: viewport eligibility via the
 * tile router, curated ordering, and the built style.
 */

import { SATELLITE_STYLE_JSON, buildSatelliteStyleJson } from '../../src/constants/satelliteStyle';
import { REGIONAL_ORTHOPHOTO_SOURCES } from '../../src/constants/orthophotoSources';
import {
  DEFAULT_MAX_VIEWPORT_SOURCES,
  buildViewportSatelliteStyle,
  selectViewportRegionalSources,
  viewportImageryAttributions,
  viewportRegionalSourceIds,
} from '../../src/services/map/satelliteRuntimeStyle';
import type { BBox } from '../../src/services/map/tileRouter';

const ZURICH: BBox = [8.5, 47.35, 8.58, 47.4];
const ROME: BBox = [12.4, 41.85, 12.55, 41.95];
const ITALY_WIDE: BBox = [6.6, 35.5, 18.6, 47.1];
const MID_ATLANTIC: BBox = [-30, -10, -25, -5];

describe('selectViewportRegionalSources', () => {
  it('returns the providers covering the viewport', () => {
    const ids = viewportRegionalSourceIds(ZURICH, 14);
    expect(ids).toContain('ortho-ch');
    // Far-away providers are not mounted.
    expect(ids).not.toContain('ortho-nz');
    expect(ids).not.toContain('ortho-om');
    expect(ids).not.toContain('ortho-qa');
  });

  it('returns nothing over a viewport no provider covers', () => {
    expect(selectViewportRegionalSources(MID_ATLANTIC, 12)).toEqual([]);
  });

  it('drops providers whose minzoom is above the current zoom', () => {
    // Italy national starts at z11 and Lazio at z15; Switzerland at z10.
    // None serve a z5 view, but France (no minzoom) does.
    const ids = viewportRegionalSourceIds(ITALY_WIDE, 5);
    expect(ids).not.toContain('ortho-it');
    expect(ids).not.toContain('ortho-it-lazio');
    expect(ids).not.toContain('ortho-ch');
    expect(ids).toContain('ortho-fr');
  });

  it('keeps the curated registry order (wider providers before narrower ones)', () => {
    const sources = selectViewportRegionalSources(ROME, 16);
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('ortho-it');
    expect(ids).toContain('ortho-it-lazio');
    expect(ids.indexOf('ortho-it')).toBeLessThan(ids.indexOf('ortho-it-lazio'));

    // Order matches the registry exactly (a filter, not a re-sort).
    const registryOrder = REGIONAL_ORTHOPHOTO_SOURCES.map((s) => s.id).filter((id) =>
      ids.includes(id),
    );
    expect(ids).toEqual(registryOrder);
  });
});

describe('buildViewportSatelliteStyle', () => {
  it('emits the global base, labels, and only the viewport providers', () => {
    const style = JSON.parse(buildViewportSatelliteStyle(ZURICH, 14));
    expect(style.version).toBe(8);
    expect(style.sources['satellite-global']).toBeDefined();
    expect(style.sources['satellite-naip']).toBeDefined();
    expect(style.sources['ortho-ch']).toBeDefined();
    expect(style.sources['ortho-nz']).toBeUndefined();

    const labels = style.layers.filter((l: any) => l.type === 'symbol');
    expect(labels.length).toBeGreaterThan(0);
    const lastRaster = style.layers
      .map((l: any, i: number) => ({ l, i }))
      .filter(({ l }) => l.type === 'raster')
      .map(({ i }) => i)
      .pop() as number;
    expect(lastRaster).toBeLessThan(style.layers.findIndex((l: any) => l.type === 'symbol'));
  });

  it('omits every regional source over an uncovered viewport', () => {
    const style = JSON.parse(buildViewportSatelliteStyle(MID_ATLANTIC, 12));
    for (const provider of REGIONAL_ORTHOPHOTO_SOURCES) {
      expect(style.sources[provider.id]).toBeUndefined();
    }
    expect(style.sources['satellite-global']).toBeDefined();
  });

  it('layers OpenAerialMap above the regional providers when coverage exists', () => {
    const coverage: BBox = [12.4, 41.85, 12.5, 41.9];
    const style = JSON.parse(buildViewportSatelliteStyle(ROME, 16, { coverage }));
    const oam = style.sources['oam'];
    expect(oam).toBeDefined();
    expect(oam.bounds).toEqual(coverage);
    expect(oam.attribution).toContain('OpenAerialMap');

    const oamIdx = style.layers.findIndex((l: any) => l.id === 'oam-tiles');
    const regionalIdx = style.layers.findIndex((l: any) => l.id === 'ortho-it-tiles');
    expect(oamIdx).toBeGreaterThan(regionalIdx);
  });

  it('does not mount OpenAerialMap without coverage', () => {
    const style = JSON.parse(buildViewportSatelliteStyle(ROME, 16));
    expect(style.sources['oam']).toBeUndefined();
  });

  it('does not layer OpenAerialMap below its minimum zoom', () => {
    const coverage: BBox = [12.4, 41.85, 12.5, 41.9];
    const style = JSON.parse(buildViewportSatelliteStyle(ROME, 8, { coverage }));
    expect(style.sources['oam']).toBeUndefined();
  });

  it('reproduces the static style when built with the full registry', () => {
    // The refactored builder must reproduce the static style exactly.
    expect(JSON.parse(buildSatelliteStyleJson())).toEqual(JSON.parse(SATELLITE_STYLE_JSON));

    const staticStyle = JSON.parse(SATELLITE_STYLE_JSON);
    // Env-gated providers are omitted when their credentials are unset.
    for (const provider of REGIONAL_ORTHOPHOTO_SOURCES.filter((p) => !p.auth)) {
      expect(staticStyle.sources[provider.id]).toBeDefined();
    }
  });
});

const EUROPE_WIDE: BBox = [-10, 35, 30, 60];

describe('provider cap', () => {
  it('mounts at most the default maximum over a wide viewport', () => {
    const ids = viewportRegionalSourceIds(EUROPE_WIDE, 10);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(DEFAULT_MAX_VIEWPORT_SOURCES);
  });

  it('honours an explicit maxSources', () => {
    const ids = viewportRegionalSourceIds(EUROPE_WIDE, 10, { maxSources: 2 });
    expect(ids.length).toBeLessThanOrEqual(2);
  });

  it('keeps the curated registry order after capping', () => {
    const ids = viewportRegionalSourceIds(EUROPE_WIDE, 10);
    const registryOrder = REGIONAL_ORTHOPHOTO_SOURCES.map((s) => s.id).filter((id) =>
      ids.includes(id),
    );
    expect(ids).toEqual(registryOrder);
  });
});

describe('viewportImageryAttributions', () => {
  it('lists the base, visible providers, and labels for the viewport', () => {
    const attrs = viewportImageryAttributions(ROME, 16);
    expect(attrs[0]).toContain('EOX');
    expect(attrs.some((a) => a.includes('PCN'))).toBe(true);
    expect(attrs.some((a) => a.includes('Lazio'))).toBe(true);
    expect(attrs).toContain('© OpenStreetMap contributors · OpenFreeMap');
  });

  it('includes the NAIP attribution only inside CONUS', () => {
    const conus: BBox = [-100, 35, -95, 40];
    expect(viewportImageryAttributions(conus, 12).some((a) => a.includes('USGS'))).toBe(true);
    expect(viewportImageryAttributions(ROME, 16).some((a) => a.includes('USGS'))).toBe(false);
  });

  it('adds the OpenAerialMap attribution when coverage is layered', () => {
    const coverage: BBox = [12.4, 41.85, 12.5, 41.9];
    const attrs = viewportImageryAttributions(ROME, 16, { coverage });
    expect(attrs.some((a) => a.includes('OpenAerialMap'))).toBe(true);
  });

  it('does not add the OpenAerialMap attribution below its minimum zoom', () => {
    const coverage: BBox = [12.4, 41.85, 12.5, 41.9];
    const attrs = viewportImageryAttributions(ROME, 8, { coverage });
    expect(attrs.some((a) => a.includes('OpenAerialMap'))).toBe(false);
  });
});
