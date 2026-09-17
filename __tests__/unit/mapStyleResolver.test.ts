import { DARK_MAP_STYLE_JSON } from '../../src/constants/darkMapStyle';
import { SATELLITE_STYLE_JSON } from '../../src/constants/satelliteStyle';
import { TERRAIN_DARK_STYLE_JSON, TERRAIN_STYLE_JSON } from '../../src/constants/terrainStyle';
import { resolveMapStyle } from '../../src/components/map/mapStyleResolver';

describe('resolveMapStyle', () => {
  it('returns the standard dark vector style when dark mode is enabled without fallback', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'default',
      isDark: true,
      styleLoadFailed: false,
    });

    expect(resolvedStyle).toBe(DARK_MAP_STYLE_JSON);
  });

  it('returns the satellite style when the user selects satellite outside compatibility mode', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'satellite',
      isDark: false,
      styleLoadFailed: false,
    });

    expect(resolvedStyle).toBe(SATELLITE_STYLE_JSON);
  });

  it('keeps using the existing dark vector style until a real load failure occurs', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'default',
      isDark: true,
      styleLoadFailed: false,
    });

    expect(resolvedStyle).toBe(DARK_MAP_STYLE_JSON);
  });

  it('returns the light raster compatibility style after a style load failure in light mode', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'default',
      isDark: false,
      styleLoadFailed: true,
    });

    const parsedStyle = JSON.parse(resolvedStyle);
    expect(parsedStyle.name).toBe('Polaris iOS26 Compat Light');
    expect(parsedStyle.sources.osm.tiles[0]).toContain('tile.openstreetmap.org');
  });

  it('returns the dark raster compatibility style after a style load failure in dark mode', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'default',
      isDark: true,
      styleLoadFailed: true,
    });

    const parsedStyle = JSON.parse(resolvedStyle);
    expect(parsedStyle.name).toBe('Polaris iOS26 Compat Dark');
    expect(parsedStyle.sources.cartoDarkMatter.tiles[0]).toContain('dark_all');
  });

  it('returns the light terrain style with a free topographic source', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'terrain',
      isDark: false,
      styleLoadFailed: false,
    });

    expect(resolvedStyle).toBe(TERRAIN_STYLE_JSON);
    const parsedStyle = JSON.parse(resolvedStyle);
    expect(parsedStyle.sources.terrain.tiles[0]).toContain('opentopomap.org');
    expect(parsedStyle.sources.terrain.attribution).toContain('OpenTopoMap');
    expect(resolvedStyle).not.toContain('arcgisonline');
  });

  it('returns the dark terrain variant in dark mode', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'terrain',
      isDark: true,
      styleLoadFailed: false,
    });
    expect(resolvedStyle).toBe(TERRAIN_DARK_STYLE_JSON);
    expect(JSON.parse(resolvedStyle).name).toBe('Polaris Terrain Dark');
  });

  it('terrain selection does not affect satellite selection', () => {
    const satellite = resolveMapStyle({
      mapStylePref: 'satellite',
      isDark: true,
      styleLoadFailed: false,
    });
    expect(satellite).toBe(SATELLITE_STYLE_JSON);
  });

  it('degrades terrain to the compatibility style on load failure', () => {
    const resolvedStyle = resolveMapStyle({
      mapStylePref: 'terrain',
      isDark: false,
      styleLoadFailed: true,
    });
    expect(JSON.parse(resolvedStyle).name).toBe('Polaris iOS26 Compat Light');
  });
});
