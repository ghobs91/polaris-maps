import { GEOLOCATION_GUARD_JS } from '../../src/constants/webViewScripts';

interface FakeGeolocation {
  getCurrentPosition: (...args: unknown[]) => void;
  watchPosition: (...args: unknown[]) => unknown;
  clearWatch: (...args: unknown[]) => void;
}

interface FakePermissions {
  query: (descriptor: { name: string }) => Promise<{ state: string }>;
}

interface FakeNavigator {
  geolocation?: FakeGeolocation;
  permissions?: FakePermissions;
}

/**
 * Evaluate the injected script the way the WebView does: with the page's
 * `navigator` and `setTimeout` bound into its scope. The timer stub runs
 * callbacks immediately so assertions stay synchronous.
 */
function runGuard(nav: FakeNavigator): void {
  const immediateTimeout = (callback: () => void) => callback();
  const evaluate = new Function('navigator', 'setTimeout', GEOLOCATION_GUARD_JS) as (
    navigator: FakeNavigator,
    setTimeout: (callback: () => void) => void,
  ) => boolean;
  evaluate(nav, immediateTimeout);
}

function makeGeolocation() {
  const originalGetCurrentPosition = jest.fn();
  const originalWatchPosition = jest.fn();
  const geolocation: FakeGeolocation = {
    getCurrentPosition: originalGetCurrentPosition,
    watchPosition: originalWatchPosition,
    clearWatch: jest.fn(),
  };
  return { geolocation, originalGetCurrentPosition, originalWatchPosition };
}

describe('GEOLOCATION_GUARD_JS', () => {
  it('fails position requests with PERMISSION_DENIED without reaching the platform API', () => {
    const { geolocation, originalGetCurrentPosition } = makeGeolocation();
    runGuard({ geolocation });

    const success = jest.fn();
    const error = jest.fn();
    geolocation.getCurrentPosition(success, error);

    expect(originalGetCurrentPosition).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({ code: 1, message: 'User denied Geolocation' });
  });

  it('fails watchPosition with PERMISSION_DENIED and returns an inert watch id', () => {
    const { geolocation, originalWatchPosition } = makeGeolocation();
    runGuard({ geolocation });

    const success = jest.fn();
    const error = jest.fn();
    const watchId = geolocation.watchPosition(success, error);

    expect(originalWatchPosition).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({ code: 1, message: 'User denied Geolocation' });
    expect(watchId).toBe(0);
    expect(() => geolocation.clearWatch(watchId)).not.toThrow();
  });

  it('reports a denied geolocation permission state', async () => {
    const originalQuery = jest.fn().mockResolvedValue({ state: 'granted' });
    const permissions = { query: originalQuery };

    runGuard({ permissions });

    await expect(permissions.query({ name: 'geolocation' })).resolves.toEqual({
      state: 'denied',
      onchange: null,
    });
    expect(originalQuery).not.toHaveBeenCalled();
  });

  it('delegates unrelated permission queries to the platform implementation', async () => {
    const originalQuery = jest.fn().mockResolvedValue({ state: 'granted' });
    const permissions = { query: originalQuery };

    runGuard({ permissions });

    await expect(permissions.query({ name: 'notifications' })).resolves.toEqual({
      state: 'granted',
    });
    expect(originalQuery).toHaveBeenCalledTimes(1);
  });

  it('is inert when the page exposes neither geolocation nor permissions', () => {
    expect(() => runGuard({})).not.toThrow();
  });
});
