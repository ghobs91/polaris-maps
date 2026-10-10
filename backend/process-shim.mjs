/**
 * Minimal `process` global for Bare.
 *
 * Bare intentionally does not expose Node's `process`, but some transitive
 * dependencies reference it (`graceful-goodbye` → `process.prependListener`,
 * `queue-tick`/`streamx` → `process.nextTick`). Provide a no-op shim so those
 * modules load and run. BareKit terminates the worklet thread natively, so
 * Node-style signal/exit handling is not needed here.
 *
 * Import this module FIRST (before any dependency) so the global exists before
 * dependency module evaluation.
 */

const Bare = globalThis.Bare;

if (typeof globalThis.process === 'undefined') {
  const microtask =
    typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (cb) => setTimeout(cb, 0);

  globalThis.process = {
    env: {},
    argv: [],
    platform: Bare && Bare.platform ? Bare.platform : 'unknown',
    arch: Bare && Bare.arch ? Bare.arch : 'unknown',
    version: '',
    versions: {},
    exitCode: 0,
    cwd: () => '/',
    nextTick: (cb, ...args) => microtask(() => cb(...args)),
    on() {},
    once() {},
    off() {},
    addListener() {},
    removeListener() {},
    prependListener() {},
    listenerCount() {
      return 0;
    },
    emit() {
      return false;
    },
    exit() {},
  };
}
