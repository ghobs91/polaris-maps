// `bootNavigation` runs at bundle-load time (from `index.js`) so a trip started
// from CarPlay on a cold launch tracks without a phone window. It must subscribe
// only after consent and must never depend on React effects/timers.
jest.mock('../../src/services/identity/consent', () => ({
  hasCompletedConsent: jest.fn(),
}));
jest.mock('../../src/services/navigation/backgroundSessionCoordinator', () => ({
  initNavigationBackgroundSession: jest.fn(),
}));
jest.mock('../../src/services/navigation/arrivalCoordinator', () => ({
  initArrivalCoordinator: jest.fn(),
}));
jest.mock('../../src/services/navigation/fixDrivenRefresh', () => ({
  initFixDrivenRefresh: jest.fn(),
}));
jest.mock('../../src/services/tts/navigationVoice', () => ({
  initNavigationVoice: jest.fn(),
}));

import fs from 'node:fs';
import path from 'node:path';
import { hasCompletedConsent } from '../../src/services/identity/consent';
import { initNavigationBackgroundSession } from '../../src/services/navigation/backgroundSessionCoordinator';
import { initArrivalCoordinator } from '../../src/services/navigation/arrivalCoordinator';
import { initFixDrivenRefresh } from '../../src/services/navigation/fixDrivenRefresh';
import { initNavigationVoice } from '../../src/services/tts/navigationVoice';
import { bootNavigation } from '../../src/services/navigation/bootNavigation';

const consentMock = hasCompletedConsent as jest.Mock;
const trackingMock = initNavigationBackgroundSession as jest.Mock;
const voiceMock = initNavigationVoice as jest.Mock;
const arrivalMock = initArrivalCoordinator as jest.Mock;
const refreshMock = initFixDrivenRefresh as jest.Mock;

describe('bootNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts the headless navigation lifecycle once consent is complete', () => {
    consentMock.mockReturnValue(true);

    bootNavigation();

    expect(trackingMock).toHaveBeenCalledTimes(1);
    expect(voiceMock).toHaveBeenCalledTimes(1);
    expect(arrivalMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not start anything before consent', () => {
    consentMock.mockReturnValue(false);

    bootNavigation();

    expect(trackingMock).not.toHaveBeenCalled();
    expect(voiceMock).not.toHaveBeenCalled();
    expect(arrivalMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('is wired into the bundle entry so it runs without React mounting', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

    expect(entry).toContain("from './src/services/navigation/bootNavigation'");
    expect(entry).toContain('bootNavigation()');
  });
});
