jest.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: { getState: jest.fn() },
}));
jest.mock('../../src/services/imagery/blurService', () => ({
  blurImage: jest.fn(),
  computeImageHash: jest.fn(),
}));
jest.mock('../../src/services/imagery/captureService', () => ({
  signImageryMetadata: jest.fn(),
  deleteCapture: jest.fn(),
}));
jest.mock('../../src/services/gun/init', () => ({ getGun: jest.fn() }));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }));

import { uploadImage } from '../../src/services/imagery/uploadService';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { blurImage } from '../../src/services/imagery/blurService';

describe('imagery upload consent gate', () => {
  it('refuses to upload when imagery sharing is disabled', async () => {
    (useSettingsStore.getState as jest.Mock).mockReturnValue({
      permissions: { imagerySharingEnabled: false },
    });

    await expect(uploadImage('file://capture.jpg', {} as never)).rejects.toThrow(/disabled/i);
    expect(blurImage).not.toHaveBeenCalled();
  });

  it('proceeds past the gate when imagery sharing is enabled', async () => {
    (useSettingsStore.getState as jest.Mock).mockReturnValue({
      permissions: { imagerySharingEnabled: true },
    });
    (blurImage as jest.Mock).mockRejectedValue(new Error('blur pipeline unavailable'));

    await expect(uploadImage('file://capture.jpg', {} as never)).rejects.toThrow(
      /blur pipeline unavailable/,
    );
    expect(blurImage).toHaveBeenCalled();
  });
});
