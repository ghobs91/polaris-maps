import {
  offlineGlyphsUrl,
  remoteGlyphUrl,
  OFFLINE_FONTS_SOURCE_ID,
  OFFLINE_FONTSTACKS,
  OFFLINE_GLYPH_RANGES,
} from '../../src/services/map/offlineFonts';

describe('offlineFonts', () => {
  it('builds the loopback glyphs template from the server base URL', () => {
    expect(offlineGlyphsUrl('http://127.0.0.1:51234')).toBe(
      `http://127.0.0.1:51234/${OFFLINE_FONTS_SOURCE_ID}/{fontstack}/{range}.pbf`,
    );
  });

  it('path-encodes spaces in the remote fontstack URL', () => {
    expect(remoteGlyphUrl('Noto Sans Regular', '0-255')).toBe(
      'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf',
    );
  });

  it('bundles the style fontstacks and the Latin+ glyph ranges', () => {
    expect(OFFLINE_FONTSTACKS).toEqual(['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']);
    expect(OFFLINE_GLYPH_RANGES).toContain('0-255');
    expect(OFFLINE_GLYPH_RANGES).toContain('256-511');
  });
});
