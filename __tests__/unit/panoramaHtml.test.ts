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

  it('pans the scene in the drag direction (grab-and-drag)', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg', 0, 0, DEFAULT_FOV_DEG);
    expect(html).toContain('yaw += dx * YAW_PER_PX;');
    expect(html).not.toContain('yaw -= dx * YAW_PER_PX;');
  });

  it('locks the drag to one axis so horizontal panning never tilts the view', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg', 0, 0, DEFAULT_FOV_DEG);
    expect(html).toContain('AXIS_LOCK_PX');
    expect(html).toContain("axis = Math.abs(tx) > Math.abs(ty) ? 'h' : 'v';");
    // Pitch only changes on the vertical axis; yaw only on the horizontal axis.
    expect(html).toContain('pitch = clampPitch(pitch + dy * PITCH_PER_PX);');
  });

  it('clamps pitch and adds inertial momentum', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg', 0, 0, DEFAULT_FOV_DEG);
    expect(html).toContain('PITCH_LIMIT = 1.05');
    expect(html).toContain('requestAnimationFrame(step)');
    expect(html).toContain('yawVel *= 0.93');
  });

  it('stitches tiles on a canvas when tile levels are provided', () => {
    const html = buildPanoramaHtml('https://img.test/fallback.jpg', 0, 0, DEFAULT_FOV_DEG, [
      {
        urlTemplate: 'https://tiles.test/t?x={x}&y={y}&zoom={z}',
        cols: 4,
        rows: 2,
        tileSize: 512,
        zoom: 2,
        width: 2048,
        height: 1024,
      },
    ]);
    // The tile level is embedded for the client-side stitcher.
    expect(html).toContain('https://tiles.test/t?x={x}&y={y}&zoom={z}');
    expect(html).toContain('TILES = [');
    expect(html).toContain("document.createElement('canvas')");
    expect(html).toContain("tile.crossOrigin = 'anonymous'");
    // The flat image stays as the fallback.
    expect(html).toContain(JSON.stringify('https://img.test/fallback.jpg'));
    expect(html).toContain('showFlat');
  });

  it('uses the flat image directly when no tile levels are provided', () => {
    const html = buildPanoramaHtml('https://img.test/a.jpg', 0, 0, DEFAULT_FOV_DEG);
    expect(html).toContain('TILES = [];');
    expect(html).toContain('showFlat();');
  });
});
