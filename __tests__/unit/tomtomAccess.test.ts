jest.mock('../../src/constants/config', () => ({ tomtomApiKey: 'test-key' }));
jest.mock('../../src/services/config/remoteConfig', () => ({
  isFeatureEnabled: jest.fn(() => true),
}));

import { isFeatureEnabled } from '../../src/services/config/remoteConfig';
import { __resetDiagnosticsForTests } from '../../src/services/diagnostics/diagnosticsLog';
import {
  TOMTOM_FAILURE_THRESHOLD,
  TOMTOM_QUOTA_BLOCK_MS,
  TOMTOM_SESSION_REQUEST_BUDGET,
  __resetTomTomAccessForTests,
  canCallTomTom,
  isTomTomConfigured,
  noteTomTomRequest,
  noteTomTomResponse,
} from '../../src/services/traffic/tomtomAccess';

const flagMock = isFeatureEnabled as jest.Mock;

describe('tomtom access guards', () => {
  beforeEach(() => {
    __resetTomTomAccessForTests();
    flagMock.mockReturnValue(true);
  });

  afterEach(() => {
    __resetTomTomAccessForTests();
    __resetDiagnosticsForTests();
  });

  it('allows requests when a key is configured and the flag is on', () => {
    expect(isTomTomConfigured()).toBe(true);
    expect(canCallTomTom(0)).toBe(true);
  });

  it('honours the remote tomtomBridge kill switch', () => {
    flagMock.mockReturnValue(false);
    expect(isTomTomConfigured()).toBe(false);
    expect(canCallTomTom(0)).toBe(false);
  });

  it('stops at the per-session request budget', () => {
    for (let i = 0; i < TOMTOM_SESSION_REQUEST_BUDGET; i++) noteTomTomRequest();
    expect(canCallTomTom(0)).toBe(false);
  });

  it('opens a 30-minute breaker on HTTP 429 but recovers afterwards', () => {
    noteTomTomResponse(429, 0);
    expect(canCallTomTom(0)).toBe(false);
    expect(canCallTomTom(TOMTOM_QUOTA_BLOCK_MS - 1)).toBe(false);
    expect(canCallTomTom(TOMTOM_QUOTA_BLOCK_MS + 1)).toBe(true);
  });

  it('opens a breaker after repeated 5xx failures', () => {
    for (let i = 0; i < TOMTOM_FAILURE_THRESHOLD; i++) noteTomTomResponse(503, 0);
    expect(canCallTomTom(0)).toBe(false);
    expect(canCallTomTom(11 * 60 * 1000)).toBe(true);
  });

  it('resets the failure streak after a successful response', () => {
    for (let i = 0; i < TOMTOM_FAILURE_THRESHOLD - 1; i++) noteTomTomResponse(503, 0);
    noteTomTomResponse(200, 0);
    for (let i = 0; i < TOMTOM_FAILURE_THRESHOLD - 1; i++) noteTomTomResponse(503, 0);
    expect(canCallTomTom(0)).toBe(true);
  });
});
