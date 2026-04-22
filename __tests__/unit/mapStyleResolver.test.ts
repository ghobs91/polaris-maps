import { DARK_MAP_STYLE_JSON } from '../../src/constants/darkMapStyle';
import { SATELLITE_STYLE_JSON } from '../../src/constants/satelliteStyle';
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
});
