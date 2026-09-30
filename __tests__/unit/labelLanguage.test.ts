/**
 * Unit tests for place-label localisation.
 *
 * Pins the OpenMapTiles name-field fallback order (user's language → script
 * variant → `name:latin` → local `name`) and that only `'{name}'`
 * `text-field`s are rewritten.
 */

import { DARK_MAP_STYLE_JSON } from '../../src/constants/darkMapStyle';
import { SATELLITE_STYLE_JSON } from '../../src/constants/satelliteStyle';
import { TERRAIN_STYLE_JSON } from '../../src/constants/terrainStyle';
import {
  applyLabelLanguage,
  getDeviceLanguage,
  labelNameExpression,
  labelNameFields,
} from '../../src/services/map/labelLanguage';

describe('labelNameFields', () => {
  it('prefers the device language, then Latin, then the local name', () => {
    expect(labelNameFields('en-US')).toEqual(['name:en', 'name:latin', 'name']);
    expect(labelNameFields('de')).toEqual(['name:de', 'name:latin', 'name']);
    expect(labelNameFields('ar-EG')).toEqual(['name:ar', 'name:latin', 'name']);
  });

  it('selects the Chinese script variant from region', () => {
    expect(labelNameFields('zh-CN')).toEqual(['name:zh-Hans', 'name:zh', 'name:latin', 'name']);
    expect(labelNameFields('zh-TW')).toEqual(['name:zh-Hant', 'name:zh', 'name:latin', 'name']);
  });

  it('handles Latin-script Serbian and Japanese', () => {
    expect(labelNameFields('sr-Latn-RS')).toEqual([
      'name:sr-Latn',
      'name:sr',
      'name:latin',
      'name',
    ]);
    expect(labelNameFields('ja-Latn')).toEqual(['name:ja-Latn', 'name:ja', 'name:latin', 'name']);
  });

  it('still falls back for an unsupported language', () => {
    expect(labelNameFields('zz')).toEqual(['name:zz', 'name:latin', 'name']);
  });
});

describe('labelNameExpression', () => {
  it('builds a coalesce over the ordered fields', () => {
    expect(labelNameExpression('fr')).toEqual([
      'coalesce',
      ['get', 'name:fr'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
  });
});

describe('getDeviceLanguage', () => {
  it('returns a non-empty locale string', () => {
    expect(typeof getDeviceLanguage()).toBe('string');
    expect(getDeviceLanguage().length).toBeGreaterThan(0);
  });
});

describe('applyLabelLanguage', () => {
  it('rewrites name labels in the vector styles', () => {
    const localized = applyLabelLanguage(SATELLITE_STYLE_JSON, 'en-US');
    expect(localized).not.toBe(SATELLITE_STYLE_JSON);

    const parsed = JSON.parse(localized);
    const city = parsed.layers.find((l: { id: string }) => l.id === 'place-city');
    expect(city.layout['text-field']).toEqual([
      'coalesce',
      ['get', 'name:en'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
  });

  it('leaves house numbers and expression fields untouched', () => {
    const parsed = JSON.parse(applyLabelLanguage(DARK_MAP_STYLE_JSON, 'en'));
    const house = parsed.layers.find((l: { id: string }) => l.id === 'housenumber');
    expect(house.layout['text-field']).toBe('{housenumber}');
  });

  it('is a no-op for a style with no vector labels', () => {
    const bare = JSON.stringify({ version: 8, layers: [{ id: 'raster', type: 'raster' }] });
    expect(applyLabelLanguage(bare, 'en')).toBe(bare);
  });

  it('localises the hybrid terrain labels too', () => {
    const parsed = JSON.parse(applyLabelLanguage(TERRAIN_STYLE_JSON, 'de'));
    const city = parsed.layers.find((l: { id: string }) => l.id === 'place-city');
    expect(JSON.stringify(city.layout['text-field'])).toContain('name:de');
  });

  it('returns invalid JSON unchanged', () => {
    expect(applyLabelLanguage('{not json', 'en')).toBe('{not json');
  });
});
