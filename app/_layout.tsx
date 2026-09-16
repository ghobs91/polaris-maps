import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { ConnectivityBanner } from '@/components/common';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { hasCompletedConsent } from '@/services/identity/consent';
import { initCarPlay } from '@/services/carplay/carPlayManager';
import { initNavigationBackgroundSession } from '@/services/navigation/backgroundSessionCoordinator';
import { initDownloadLiveActivity } from '@/services/regions/downloadLiveActivity';
import {
  initTrafficP2P,
  disposeTrafficP2P,
  suspendTrafficP2P,
  resumeTrafficP2P,
} from '@/services/traffic/trafficFlowService';
import {
  initProbeCollection,
  disposeProbeCollection,
} from '@/services/traffic/probeCollectionCoordinator';
import { initRerouteMonitor, disposeRerouteMonitor } from '@/services/traffic/rerouteCoordinator';
import {
  initIncidentExchange,
  disposeIncidentExchange,
} from '@/services/traffic/incidentExchangeService';
import { startMonitoring as startConnectivityMonitoring } from '@/services/regions/connectivityService';
import { scheduleGeonamesDownload } from '@/services/geocoding/geonamesDownloadScheduler';
import { useAtprotoAuthStore } from '@/stores/atprotoAuthStore';
import { useICloudSync } from '@/hooks/useICloudSync';

function RootLayoutInner() {
  const { isDark, colors } = useTheme();

  // Sync place lists + favorites with iCloud for the whole app lifetime.
  // Previously this only ran while the My Places tab was mounted, so edits
  // made elsewhere (e.g. Home/Work favorites) never synced.
  useICloudSync();

  useEffect(() => {
    useAtprotoAuthStore.getState().restore();
    // Track connectivity for the banner, offline gating, and map fallback.
    // Previously never started, so isOnline() was stuck at its optimistic
    // default and the map never knew the connection was weak.
    startConnectivityMonitoring();
    // Keep the iOS background navigation session in sync with navigation
    // state (starts/stops it wherever navigation is triggered from).
    initNavigationBackgroundSession();
    // Show aggregate offline-download progress in a Live Activity while the
    // app is backgrounded during an active region download.
    initDownloadLiveActivity();
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
    // Download the offline GeoNames city database opportunistically (Wi-Fi
    // preferred, silent no-op when no URL is configured).
    return scheduleGeonamesDownload();
  }, []);

  useEffect(() => {
    // Start the P2P traffic mesh (Hyperswarm worklet + Nostr fallback) after
    // initial interactions so the map's first paint isn't delayed.
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void initTrafficP2P().catch(() => {});
    });

    // Consent-gated probe contribution. The coordinator owns its own
    // foreground/background lifecycle and reacts to consent changes.
    initProbeCollection();

    // Congestion rerouting follows the navigation lifecycle.
    initRerouteMonitor();

    // Receive, verify, and persist crowd-reported incidents from both transports.
    initIncidentExchange();

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
      disposeProbeCollection();
      disposeRerouteMonitor();
      disposeIncidentExchange();
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
      <ConsentGate />
    </ThemeProvider>
  );
}

/**
 * Blocks the tab stack (and every map/network effect it owns) until the user
 * has completed the consent flow, so no collector or P2P mesh starts before
 * consent exists. Re-consent after a version change re-enters this gate.
 */
function ConsentGate() {
  const [consentComplete, setConsentComplete] = useState(() => hasCompletedConsent());

  if (!consentComplete) {
    return <OnboardingFlow onComplete={() => setConsentComplete(true)} />;
  }

  return <RootLayoutInner />;
}
