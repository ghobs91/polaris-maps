import {
  DEFAULT_TOAST_MAX,
  enqueueToast,
  removeToast,
  type ToastItem,
} from '../../src/utils/toastQueue';

function toast(id: string): ToastItem {
  return { id, message: `message ${id}`, durationMs: 4000 };
}

describe('toastQueue', () => {
  it('appends toasts in order', () => {
    const queue = enqueueToast(enqueueToast([], toast('a')), toast('b'));
    expect(queue.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('caps the queue at the newest entries', () => {
    let queue: ToastItem[] = [];
    for (const id of ['a', 'b', 'c', 'd']) queue = enqueueToast(queue, toast(id));

    expect(queue.map((t) => t.id)).toEqual(['b', 'c', 'd']);
    expect(queue).toHaveLength(DEFAULT_TOAST_MAX);
  });

  it('removes a toast by id', () => {
    const queue = enqueueToast(enqueueToast([], toast('a')), toast('b'));
    expect(removeToast(queue, 'a').map((t) => t.id)).toEqual(['b']);
    expect(removeToast(queue, 'missing').map((t) => t.id)).toEqual(['a', 'b']);
  });
});
