import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Switch, Pressable } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Button } from '@/components/common';
import { colors, spacing, typography, borderRadius } from '@/constants/theme';
import { useMapStore } from '@/stores/mapStore';
import { storage } from '@/services/storage/mmkv';
import {
  applyConsentChoices,
  getDefaultConsentChoices,
  type ConsentChoices,
} from '@/services/identity/consent';

const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

interface ConsentToggleProps {
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}

function ConsentToggle({ label, description, value, onToggle }: ConsentToggleProps) {
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

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [locationGranted, setLocationGranted] = useState(false);
  const [consent, setConsent] = useState<ConsentChoices>(getDefaultConsentChoices);
  const setViewport = useMapStore((s) => s.setViewport);
  const router = useRouter();

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
    storage.set(ONBOARDING_COMPLETE_KEY, 'true');
    router.replace('/(tabs)');
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      {step === 0 && (
        <View style={styles.card}>
          <Text style={styles.title}>Welcome to Polaris Maps</Text>
          <Text style={styles.body}>
            A fully decentralized mapping app. No servers, no tracking — just you and the open road.
          </Text>
          <Text style={styles.body}>
            We need location access to center the map and provide navigation.
          </Text>
          <Button title="Grant Location Access" onPress={requestLocation} />
          <Button title="Skip" onPress={() => setStep(1)} variant="ghost" />
        </View>
      )}

      {step === 1 && (
        <View style={styles.card}>
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
        </View>
      )}

      {step === 2 && (
        <View style={styles.card}>
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
          <Button title="Browse Regions" onPress={completeOnboarding} />
          <Button title="Skip for Now" onPress={completeOnboarding} variant="ghost" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    gap: spacing.md,
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
