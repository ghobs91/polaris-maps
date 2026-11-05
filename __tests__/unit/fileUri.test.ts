import { toFilePath, toFileUri } from '../../src/utils/fileUri';

describe('toFileUri', () => {
  it('adds the scheme to a filesystem path', () => {
    expect(toFileUri('/var/mobile/Documents/dashcam/a.mp4')).toBe(
      'file:///var/mobile/Documents/dashcam/a.mp4',
    );
  });

  it('leaves an existing URI untouched', () => {
    expect(toFileUri('file:///var/mobile/Documents/dashcam/a.mp4')).toBe(
      'file:///var/mobile/Documents/dashcam/a.mp4',
    );
  });
});

describe('toFilePath', () => {
  it('strips the scheme for native file APIs', () => {
    expect(toFilePath('file:///var/mobile/Documents/dashcam/a.mp4')).toBe(
      '/var/mobile/Documents/dashcam/a.mp4',
    );
  });

  it('leaves a plain path untouched', () => {
    expect(toFilePath('/var/mobile/Documents/dashcam/a.mp4')).toBe(
      '/var/mobile/Documents/dashcam/a.mp4',
    );
  });

  it('decodes percent-encoded path segments', () => {
    expect(toFilePath('file:///var/mobile/My%20Drive/a.mp4')).toBe('/var/mobile/My Drive/a.mp4');
  });
});
