import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { ConnectivityBanner } from '@/components/common';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { initCarPlay } from '@/services/carplay/carPlayManager';
import { initNavigationBackgroundSession } from '@/services/navigation/backgroundSessionCoordinator';
import {
  initTrafficP2P,
  disposeTrafficP2P,
  suspendTrafficP2P,
  resumeTrafficP2P,
} from '@/services/traffic/trafficFlowService';
import { useAtprotoAuthStore } from '@/stores/atprotoAuthStore';

function RootLayoutInner() {
  const { isDark, colors } = useTheme();

  useEffect(() => {
    useAtprotoAuthStore.getState().restore();
    // Keep the iOS background navigation session in sync with navigation
    // state (starts/stops it wherever navigation is triggered from).
    initNavigationBackgroundSession();
  }, []);

  useEffect(() => {
    // Defer CarPlay init until after the initial render & layout pass completes.
    // This avoids interfering with MapLibre's first camera setup.
    const task = InteractionManager.runAfterInteractions(() => {
      initCarPlay();
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    // Start the P2P traffic mesh (Hyperswarm worklet + Nostr fallback) after
    // initial interactions so the map's first paint isn't delayed.
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void initTrafficP2P().catch(() => {});
    });

    // Suspend/resume the mesh with the app lifecycle to save battery.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') resumeTrafficP2P();
      else if (state === 'background') suspendTrafficP2P();
    };
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelled = true;
      task.cancel();
      sub.remove();
      disposeTrafficP2P();
    };
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
