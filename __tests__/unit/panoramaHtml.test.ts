import { buildPanoramaHtml, DEFAULT_FOV_DEG } from '../../src/components/imagery/panoramaHtml';

describe('buildPanoramaHtml', () => {
  it('embeds the image URL as a safely-escaped string', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg?x="q"', 0, 0, DEFAULT_FOV_DEG);
    expect(html).toContain(JSON.stringify('https://img.test/a.jpg?x="q"'));
    expect(html).toContain('crossOrigin');
    expect(html).toContain("image.crossOrigin = 'anonymous'");
  });

  it('converts the initial yaw/pitch/fov from degrees to radians', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg', 90, 0, 75);
    expect(html).toContain('yaw = 1.5707963267948966');
    expect(html).toContain('pitch = 0');
    expect(html).toContain('fov = 1.3089969389957472');
  });

  it('includes a WebGL equirectangular shader and a flat fallback', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg', 0, 0, DEFAULT_FOV_DEG);
    expect(html).toContain('texture2D(uTex,uv)');
    expect(html).toContain('id="fb"');
    expect(html).toContain('experimental-webgl');
  });
});
