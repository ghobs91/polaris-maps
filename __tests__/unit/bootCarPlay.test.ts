// `bootCarPlay` runs at bundle-load time (from `index.js`) so CarPlay works on a
// cold launch with no phone window. It must subscribe only after consent and
// must never depend on React effects/timers.
jest.mock('../../src/services/identity/consent', () => ({
  hasCompletedConsent: jest.fn(),
}));
jest.mock('../../src/services/carplay/carPlayManager', () => ({
  initCarPlay: jest.fn(),
}));

import fs from 'node:fs';
import path from 'node:path';
import { hasCompletedConsent } from '../../src/services/identity/consent';
import { initCarPlay } from '../../src/services/carplay/carPlayManager';
import { bootCarPlay } from '../../src/services/carplay/bootCarPlay';

const consentMock = hasCompletedConsent as jest.Mock;
const initMock = initCarPlay as jest.Mock;

describe('bootCarPlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initialises CarPlay at bundle load once consent is complete', () => {
    consentMock.mockReturnValue(true);

    bootCarPlay();

    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('does not initialise CarPlay before consent', () => {
    consentMock.mockReturnValue(false);

    bootCarPlay();

    expect(initMock).not.toHaveBeenCalled();
  });

  it('is wired into the bundle entry so it runs without React mounting', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

    expect(entry).toContain("from './src/services/carplay/bootCarPlay'");
    expect(entry).toContain('bootCarPlay()');
  });
});
