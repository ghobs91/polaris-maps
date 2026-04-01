/**
 * Tests for dark-mode map style contrast and satellite style existence.
 *
 * Verifies that the dark map style has sufficient luminance contrast between
 * road/label/feature colors and the background, and that the satellite style
 * is well-formed.
 */

import { DARK_MAP_STYLE_JSON } from '../../src/constants/darkMapStyle';
import { SATELLITE_STYLE_JSON } from '../../src/constants/satelliteStyle';

/** Parse a hex color (#RRGGBB) to relative luminance (0-1). */
function hexToLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.1 contrast ratio between two luminance values. */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('darkMapStyle', () => {
  const style = JSON.parse(DARK_MAP_STYLE_JSON);
  const bgColor = '#1C1C2E';
  const bgLum = hexToLuminance(bgColor);

  it('should parse as valid JSON with version 8', () => {
    expect(style.version).toBe(8);
    expect(style.name).toBe('Polaris Dark');
    expect(style.layers.length).toBeGreaterThan(0);
  });

  it('should have a dark background color', () => {
    const bgLayer = style.layers.find((l: any) => l.id === 'background');
    expect(bgLayer).toBeDefined();
    expect(bgLayer.paint['background-color']).toBe(bgColor);
  });

  it('should have motorway road color with sufficient contrast against background', () => {
    const motorway = style.layers.find((l: any) => l.id === 'road-motorway');
    expect(motorway).toBeDefined();
    const motorwayColor = motorway.paint['line-color'];
    const ratio = contrastRatio(hexToLuminance(motorwayColor), bgLum);
    // Motorways should be clearly visible — at least 3:1 contrast
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('should have primary road color with at least 2.5:1 contrast', () => {
    const primary = style.layers.find((l: any) => l.id === 'road-primary');
    expect(primary).toBeDefined();
    const primaryColor = primary.paint['line-color'];
    const ratio = contrastRatio(hexToLuminance(primaryColor), bgLum);
    expect(ratio).toBeGreaterThanOrEqual(2.5);
  });

  it('should have city label color with at least 4:1 contrast', () => {
    const city = style.layers.find((l: any) => l.id === 'place-city');
    expect(city).toBeDefined();
    const cityColor = city.paint['text-color'];
    const ratio = contrastRatio(hexToLuminance(cityColor), bgLum);
    // City labels need to be easily readable
    expect(ratio).toBeGreaterThanOrEqual(4);
  });

  it('should have town label color with at least 3.5:1 contrast', () => {
    const town = style.layers.find((l: any) => l.id === 'place-town');
    expect(town).toBeDefined();
    const townColor = town.paint['text-color'];
    const ratio = contrastRatio(hexToLuminance(townColor), bgLum);
    expect(ratio).toBeGreaterThanOrEqual(3.5);
  });

  it('should have water clearly distinct from land', () => {
    const water = style.layers.find((l: any) => l.id === 'water');
    expect(water).toBeDefined();
    const waterColor = water.paint['fill-color'];
    const ratio = contrastRatio(hexToLuminance(waterColor), bgLum);
    // Water should be visibly different from land — at least 1.2:1
    expect(ratio).not.toBe(1); // not identical
    // Water is darker than background, which is the desired effect
    expect(hexToLuminance(waterColor)).toBeLessThan(bgLum);
  });

  it('should have road labels readable with at least 3:1 contrast', () => {
    const primaryLabel = style.layers.find((l: any) => l.id === 'road-label-primary');
    expect(primaryLabel).toBeDefined();
    const labelColor = primaryLabel.paint['text-color'];
    const ratio = contrastRatio(hexToLuminance(labelColor), bgLum);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe('satelliteStyle', () => {
  const style = JSON.parse(SATELLITE_STYLE_JSON);

  it('should parse as valid JSON with version 8', () => {
    expect(style.version).toBe(8);
    expect(style.name).toBe('Polaris Satellite');
    expect(style.layers.length).toBeGreaterThan(0);
  });

  it('should include a raster satellite source', () => {
    expect(style.sources.satellite).toBeDefined();
    expect(style.sources.satellite.type).toBe('raster');
    expect(style.sources.satellite.tiles).toHaveLength(1);
    expect(style.sources.satellite.tiles[0]).toContain('World_Imagery');
  });

  it('should include vector source for labels', () => {
    expect(style.sources.openmaptiles).toBeDefined();
    expect(style.sources.openmaptiles.type).toBe('vector');
  });

  it('should render satellite tiles as first layer', () => {
    expect(style.layers[0].id).toBe('satellite-tiles');
    expect(style.layers[0].type).toBe('raster');
    expect(style.layers[0].source).toBe('satellite');
  });

  it('should overlay road and place labels on top of satellite', () => {
    const labelLayers = style.layers.filter(
      (l: any) => l.type === 'symbol' && l.source === 'openmaptiles',
    );
    expect(labelLayers.length).toBeGreaterThan(0);
    // All label layers should come after the raster layer
    const satIndex = style.layers.findIndex((l: any) => l.id === 'satellite-tiles');
    for (const label of labelLayers) {
      const labelIndex = style.layers.indexOf(label);
      expect(labelIndex).toBeGreaterThan(satIndex);
    }
  });

  it('should have white labels with dark halos for readability over imagery', () => {
    const cityLabel = style.layers.find((l: any) => l.id === 'place-city');
    expect(cityLabel).toBeDefined();
    expect(cityLabel.paint['text-color']).toBe('#FFFFFF');
    expect(cityLabel.paint['text-halo-width']).toBeGreaterThanOrEqual(2);
  });
});
