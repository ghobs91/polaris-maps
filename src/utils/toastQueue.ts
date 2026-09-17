/** Pure queue helpers for the toast provider (unit-testable). */

export interface ToastItem {
  id: string;
  message: string;
  actionLabel?: string;
  durationMs: number;
}

export const DEFAULT_TOAST_DURATION_MS = 4000;
export const DEFAULT_TOAST_MAX = 3;

/** Append a toast, keeping only the newest `max` entries. */
export function enqueueToast(
  queue: readonly ToastItem[],
  item: ToastItem,
  max: number = DEFAULT_TOAST_MAX,
): ToastItem[] {
  const next = [...queue, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function removeToast(queue: readonly ToastItem[], id: string): ToastItem[] {
  return queue.filter((toast) => toast.id !== id);
}
