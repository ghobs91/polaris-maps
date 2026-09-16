/**
 * Request throttle tests: shared Nominatim rate limiting is abort-aware.
 */

import { abortError, isAbortError } from '../../src/services/search/abortUtils';
import {
  createRequestThrottle,
  NOMINATIM_MIN_INTERVAL_MS,
} from '../../src/services/search/requestThrottle';

describe('requestThrottle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits out the remaining interval between requests', async () => {
    const throttle = createRequestThrottle(1000);
    await throttle.wait();

    let resolved = false;
    const second = throttle.wait().then(() => {
      resolved = true;
    });

    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(600);
    await second;
    expect(resolved).toBe(true);
  });

  it('does not wait when enough time has already elapsed', async () => {
    const throttle = createRequestThrottle(1000);
    await throttle.wait();
    jest.advanceTimersByTime(NOMINATIM_MIN_INTERVAL_MS + 1);
    await expect(throttle.wait()).resolves.toBeUndefined();
  });

  it('rejects promptly when superseded during the wait', async () => {
    const throttle = createRequestThrottle(1000);
    await throttle.wait();

    const controller = new AbortController();
    const pending = throttle.wait(controller.signal);
    controller.abort();

    const err = await pending.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(abortError().name).toBe('AbortError');
  });
});
