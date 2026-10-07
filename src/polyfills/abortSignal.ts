/**
 * `AbortSignal.prototype.throwIfAborted` polyfill for React Native.
 *
 * React Native installs `abort-controller@3` as the global `AbortController` /
 * `AbortSignal`, and that implementation does not provide `throwIfAborted()`
 * (nor `reason`).
 *
 * `@atproto/oauth-client` calls `signal.throwIfAborted()` while resolving the
 * account identity after the browser authorization step (`verifyIssuer` passes
 * a timeout signal). Without this polyfill the OAuth callback fails with
 * `TypeError: undefined is not a function`.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted
 */

type AbortSignalLike = {
  aborted?: boolean;
  reason?: unknown;
  throwIfAborted?: () => void;
};

const proto =
  typeof AbortSignal !== 'undefined'
    ? (AbortSignal.prototype as unknown as AbortSignalLike)
    : undefined;

if (proto && typeof proto.throwIfAborted !== 'function') {
  proto.throwIfAborted = function throwIfAborted(this: AbortSignalLike): void {
    if (this.aborted) {
      throw this.reason ?? new Error('This operation was aborted');
    }
  };
}
