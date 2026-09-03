import {
  abortError,
  isAbortError,
  sleepWithAbort,
  throwIfAborted,
  withTimeout,
} from '../../src/services/search/abortUtils';

describe('abortError / isAbortError', () => {
  it('creates an AbortError-shaped error', () => {
    const err = abortError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AbortError');
    expect(isAbortError(err)).toBe(true);
  });

  it('rejects non-abort errors and non-objects', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

describe('throwIfAborted', () => {
  it('does nothing without a signal or when not aborted', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });

  it('throws AbortError when aborted', () => {
    const controller = new AbortController();
    controller.abort();
    try {
      throwIfAborted(controller.signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect(isAbortError(err)).toBe(true);
    }
  });
});

describe('sleepWithAbort', () => {
  it('resolves after the delay', async () => {
    await expect(sleepWithAbort(10)).resolves.toBeUndefined();
  });

  it('resolves immediately for non-positive delays', async () => {
    await expect(sleepWithAbort(0)).resolves.toBeUndefined();
  });

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithAbort(1000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects when aborted mid-sleep instead of waiting out the delay', async () => {
    const controller = new AbortController();
    const pending = sleepWithAbort(10_000, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
  });
});

describe('withTimeout', () => {
  it('aborts after the timeout elapses', async () => {
    const { signal, cleanup } = withTimeout(undefined, 10);
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('propagates an outer abort to the combined signal', () => {
    const outer = new AbortController();
    const { signal, cleanup } = withTimeout(outer.signal, 10_000);
    expect(signal.aborted).toBe(false);
    outer.abort();
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('starts aborted when the outer signal is already aborted', () => {
    const outer = new AbortController();
    outer.abort();
    const { signal, cleanup } = withTimeout(outer.signal, 10_000);
    expect(signal.aborted).toBe(true);
    cleanup();
  });
});
