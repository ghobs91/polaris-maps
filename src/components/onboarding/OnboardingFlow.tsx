import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Switch, Pressable } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Button, GlassView } from '@/components/common';
import { spacing, typography, borderRadius } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { useMapStore } from '@/stores/mapStore';
import { useReviewImportStore } from '@/stores/reviewImportStore';
import { TAKEOUT_REQUEST_STEPS } from '@/components/reviews/takeoutCopy';
import {
  applyConsentChoices,
  getConsentChoices,
  getDefaultConsentChoices,
  hasCompletedConsent,
  type ConsentChoices,
} from '@/services/identity/consent';

interface OnboardingFlowProps {
  /**
   * Step to open on. First-run gating starts at the welcome step (0); a
   * re-consent entry from Settings opens directly on the choices step (1).
   */
  initialStep?: number;
  /** Called when the flow completes. When omitted, the route is dismissed. */
  onComplete?: () => void;
}

interface ConsentToggleProps {
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}

function ConsentToggle({ label, description, value, onToggle }: ConsentToggleProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable style={styles.toggleRow} onPress={() => onToggle(!value)}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </Pressable>
  );
}

export function OnboardingFlow({ initialStep = 0, onComplete }: OnboardingFlowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [step, setStep] = useState(initialStep);
  const [locationGranted, setLocationGranted] = useState(false);
  // Pre-fill from saved choices on re-consent; first-run starts privacy-preserving (all off).
  const [consent, setConsent] = useState<ConsentChoices>(() =>
    hasCompletedConsent() ? getConsentChoices() : getDefaultConsentChoices(),
  );
  const setViewport = useMapStore((s) => s.setViewport);
  const snoozeTakeoutReminder = useReviewImportStore((s) => s.snoozeTakeoutReminder);
  const router = useRouter();
  /** First-run starts at the welcome step; re-consent entries start later. */
  const isFirstRun = initialStep === 0;

  const requestLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationGranted(true);
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setViewport({ lat: loc.coords.latitude, lng: loc.coords.longitude, zoom: 12 });
      } catch {
        // location unavailable, use defaults
      }
    }
    setStep(1);
  }, [setViewport]);

  const updateConsent = useCallback((key: keyof ConsentChoices, value: boolean) => {
    setConsent((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submitConsent = useCallback(() => {
    applyConsentChoices(consent);
    setStep(2);
  }, [consent]);

  const completeOnboarding = useCallback(() => {
    if (onComplete) {
      onComplete();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [onComplete, router]);

  /** Region step leads into the Google-data step on first run; re-consent exits directly. */
  const afterRegions = useCallback(() => {
    if (isFirstRun) setStep(3);
    else completeOnboarding();
  }, [isFirstRun, completeOnboarding]);

  const remindMeLater = useCallback(() => {
    snoozeTakeoutReminder();
    completeOnboarding();
  }, [snoozeTakeoutReminder, completeOnboarding]);

  return (
    <SafeAreaView style={styles.container}>
      {step === 0 && (
        <GlassView material="regular" style={styles.card}>
          <Text style={styles.title}>Welcome to Polaris Maps</Text>
          <Text style={styles.body}>
            A fully decentralized mapping app. No servers, no tracking — just you and the open road.
            Every phone is a node: you share traffic, places, tiles, and imagery peer-to-peer.
          </Text>
          <Text style={styles.body}>
            No accounts — a secp256k1 key in your secure enclave is your identity, and actions are
            Schnorr-signed. CarPlay mirrors navigation when connected.
          </Text>
          <Text style={styles.body}>
            We need location access to center the map and provide navigation.
          </Text>
          <Button title="Grant Location Access" onPress={requestLocation} />
          <Button title="Skip" onPress={() => setStep(1)} variant="ghost" />
        </GlassView>
      )}

      {step === 1 && (
        <GlassView material="regular" style={styles.card}>
          <Text style={styles.title}>Privacy Choices</Text>
          <Text style={styles.body}>
            Choose what you share. Each option is independent — you can change these later in
            Settings.
          </Text>
          <ConsentToggle
            label="Location for Navigation"
            description="Used to center the map and provide turn-by-turn directions."
            value={consent.locationEnabled}
            onToggle={(v) => updateConsent('locationEnabled', v)}
          />
          <ConsentToggle
            label="Traffic Telemetry"
            description="Share anonymized speed data to help others avoid congestion."
            value={consent.trafficTelemetryEnabled}
            onToggle={(v) => updateConsent('trafficTelemetryEnabled', v)}
          />
          <ConsentToggle
            label="POI Contributions"
            description="Add and edit places, write reviews, and verify edits."
            value={consent.poiContributionsEnabled}
            onToggle={(v) => updateConsent('poiContributionsEnabled', v)}
          />
          <ConsentToggle
            label="Street-Level Imagery"
            description="Capture and share geotagged photos (faces and plates are blurred on-device)."
            value={consent.imagerySharingEnabled}
            onToggle={(v) => updateConsent('imagerySharingEnabled', v)}
          />
          <Button title="Continue" onPress={submitConsent} />
        </GlassView>
      )}

      {step === 2 && (
        <GlassView material="regular" style={styles.card}>
          <Text style={styles.title}>Download a Region</Text>
          <Text style={styles.body}>
            Polaris Maps works offline. Download a region to get started with map tiles, routing,
            and search data.
          </Text>
          {locationGranted && (
            <Text style={styles.hint}>
              We detected your location — we'll suggest nearby regions.
            </Text>
          )}
          <Button title="Browse Regions" onPress={afterRegions} />
          <Button title="Skip for Now" onPress={afterRegions} variant="ghost" />
        </GlassView>
      )}

      {step === 3 && (
        <GlassView material="regular" style={styles.card}>
          <Text style={styles.title}>Bring your Google data</Text>
          <Text style={styles.body}>
            Already use Google Maps? Bring your saved places and reviews with you. Both imports live
            in My Places after setup — saved-place files import any time, and Reviews.json needs a
            Bluesky sign-in (in Settings) since each review is published to your account.
          </Text>
          <Text style={styles.body}>To request your export:</Text>
          {TAKEOUT_REQUEST_STEPS.map((item, i) => (
            <Text key={i} style={styles.step}>
              {i + 1}. {item}
            </Text>
          ))}
          <Text style={styles.hint}>
            Google usually takes a few hours — we can remind you tomorrow to do the imports.
          </Text>
          <Button title="Remind me in 24 hours" onPress={remindMeLater} />
          <Button title="Skip" onPress={completeOnboarding} variant="ghost" />
        </GlassView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      padding: spacing.xl,
      gap: spacing.md,
      borderRadius: borderRadius.xl,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    title: {
      ...typography.h1,
      color: colors.text,
      textAlign: 'center',
    },
    body: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    hint: {
      ...typography.caption,
      color: colors.primary,
      textAlign: 'center',
    },
    step: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'left',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    toggleText: {
      flex: 1,
      marginRight: spacing.md,
    },
    toggleLabel: {
      ...typography.body,
      color: colors.text,
      fontWeight: '600',
    },
    toggleDesc: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
