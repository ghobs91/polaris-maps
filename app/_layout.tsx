import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ConnectivityBanner } from '@/components/common';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

function RootLayoutInner() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ConnectivityBanner />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
        <Stack.Screen name="poi/[id]" options={{ title: 'Place Details' }} />
        <Stack.Screen name="poi/edit" options={{ title: 'Edit Place' }} />
        <Stack.Screen name="poi/reviews" options={{ title: 'Reviews' }} />
        <Stack.Screen name="regions/index" options={{ title: 'Download Regions' }} />
        <Stack.Screen name="regions/offline" options={{ title: 'Offline Regions' }} />
        <Stack.Screen name="imagery/viewer" options={{ title: 'Street View' }} />
        <Stack.Screen name="imagery/capture" options={{ title: 'Capture' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
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
