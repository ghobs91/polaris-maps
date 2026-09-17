import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

export type Theme = ReturnType<typeof useTheme>;

/**
 * Memoized themed-styles helper — the migration pattern for replacing static
 * light-only `colors` imports in user-facing components.
 *
 * Define `createStyles(theme)` at module scope (so its identity is stable) and
 * call `useThemedStyles(createStyles)` inside the component; styles recompute
 * only when the theme changes.
 */
export function useThemedStyles<T>(create: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => create(theme), [create, theme]);
}
