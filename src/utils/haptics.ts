import * as Haptics from 'expo-haptics';

/**
 * Thin, fire-and-forget haptics helpers. Every call is best-effort: haptics
 * are unavailable on some devices/emulators and must never throw into a
 * gesture or press handler.
 */

export function hapticSelection(): void {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function hapticImpact(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void {
  void Haptics.impactAsync(style).catch(() => undefined);
}

export function hapticSuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function hapticWarning(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
