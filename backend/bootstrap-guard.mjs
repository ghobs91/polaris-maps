/**
 * Bare worklet bootstrap guard.
 *
 * Bare's default `unhandledRejection` behaviour terminates the runtime, which
 * `react-native-bare-kit` surfaces to the OS as a host SIGABRT — so a single
 * stray rejected promise anywhere in the worklet (or one of its dependencies)
 * takes down the entire app on the worklet thread.
 *
 * Register a handler before any dependency is evaluated so a rejected promise
 * is logged and the worklet keeps running instead of aborting the process.
 *
 * Import this module FIRST (before any dependency) so the handler exists before
 * module evaluation can produce a rejection.
 */

const BareRuntime = globalThis.Bare;

if (BareRuntime && typeof BareRuntime.on === 'function') {
  BareRuntime.on('unhandledRejection', (reason) => {
    console.error('[bare-worklet] unhandled rejection:', reason);
  });
}
