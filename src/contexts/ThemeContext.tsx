import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { colors, darkColors, type AppColorsLoose } from '@/constants/theme';
import { useSettingsStore } from '@/stores/settingsStore';

interface ThemeContextValue {
  isDark: boolean;
  colors: AppColorsLoose;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  colors,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const themeMode = useSettingsStore((s) => s.themeMode);

  const isDark = useMemo(() => {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return systemScheme === 'dark';
  }, [themeMode, systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ isDark, colors: isDark ? darkColors : colors }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
