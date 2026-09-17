import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { borderRadius, spacing, typography } from '../constants/theme';
import { useTheme } from './ThemeContext';
import { hapticImpact } from '../utils/haptics';
import {
  DEFAULT_TOAST_DURATION_MS,
  enqueueToast,
  removeToast,
  type ToastItem,
} from '../utils/toastQueue';

export interface ShowToastOptions {
  message: string;
  /** Optional action (e.g. "Undo"); pressing it runs `onAction` then dismisses. */
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (options: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

/**
 * App-wide toast host with an optional Undo action, used for destructive
 * actions (clear parking spot, remove favorite) so a single tap is reversible.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const actionsRef = useRef(new Map<string, () => void>());
  const counterRef = useRef(0);

  const showToast = useCallback((options: ShowToastOptions) => {
    const id = `toast-${++counterRef.current}`;
    if (options.onAction) actionsRef.current.set(id, options.onAction);
    setQueue((current) =>
      enqueueToast(current, {
        id,
        message: options.message,
        actionLabel: options.actionLabel,
        durationMs: options.durationMs ?? DEFAULT_TOAST_DURATION_MS,
      }),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    actionsRef.current.delete(id);
    setQueue((current) => removeToast(current, id));
  }, []);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismiss(current.id), current.durationMs);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {current ? (
        <View
          style={[styles.toast, { bottom: insets.bottom + 16, backgroundColor: colors.text }]}
          testID="toast"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.message, { color: colors.background }]} numberOfLines={2}>
            {current.message}
          </Text>
          {current.actionLabel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={current.actionLabel}
              testID="toast-action"
              onPress={() => {
                hapticImpact();
                actionsRef.current.get(current.id)?.();
                dismiss(current.id);
              }}
              hitSlop={8}
              style={styles.action}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>
                {current.actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  message: { ...typography.body, flex: 1 },
  action: { minHeight: 44, justifyContent: 'center' },
  actionText: { ...typography.body, fontWeight: '600' },
});
