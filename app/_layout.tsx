import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo } from 'react';
import { InteractionManager } from 'react-native';
import { ConnectivityBanner } from '@/components/common';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { initCarPlay } from '@/services/carplay/carPlayManager';
import { useAtprotoAuthStore } from '@/stores/atprotoAuthStore';

function RootLayoutInner() {
  const { isDark, colors } = useTheme();

  useEffect(() => {
    useAtprotoAuthStore.getState().restore();
  }, []);

  useEffect(() => {
    // Defer CarPlay init until after the initial render & layout pass completes.
    // This avoids interfering with MapLibre's first camera setup.
    const task = InteractionManager.runAfterInteractions(() => {
      initCarPlay();
    });
    return () => task.cancel();
  }, []);

  // Theme-aware header chrome so the nav bar matches dark/light Settings.
  const screenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.primary,
      headerTitleStyle: { color: colors.text, fontWeight: '600' as const },
      headerShadowVisible: false,
      headerBackVisible: true,
      contentStyle: { backgroundColor: colors.background },
    }),
    [colors.background, colors.primary, colors.text],
  );

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ConnectivityBanner />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
        <Stack.Screen name="poi/[id]" options={{ title: 'Place Details' }} />
        <Stack.Screen name="poi/edit" options={{ title: 'Edit Place' }} />
        <Stack.Screen name="poi/osm-edit" options={{ title: 'Update Place Info' }} />
        <Stack.Screen name="poi/reviews" options={{ title: 'Reviews' }} />
        <Stack.Screen name="regions/index" options={{ title: 'Download Regions' }} />
        <Stack.Screen name="regions/offline" options={{ title: 'Offline Regions' }} />
        <Stack.Screen name="imagery/viewer" options={{ title: 'Street View' }} />
        <Stack.Screen name="imagery/capture" options={{ title: 'Capture' }} />
        <Stack.Screen name="settings/index" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="places/list" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}
