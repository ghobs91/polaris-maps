import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS "Reduce Motion" preference is enabled. Consumers should skip
 * or shorten camera / sheet animations when true.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => {
      setReduced(value);
    });

    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}
