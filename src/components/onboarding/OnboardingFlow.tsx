import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Switch, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Button, GlassView } from '@/components/common';
import { spacing, typography, borderRadius } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { useMapStore } from '@/stores/mapStore';
import { useReviewImportStore } from '@/stores/reviewImportStore';
import { TAKEOUT_ONBOARDING_STEPS } from '@/components/reviews/takeoutCopy';
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
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}

function ConsentToggle({ icon, label, description, value, onToggle }: ConsentToggleProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      style={styles.toggleRow}
      onPress={() => onToggle(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
    >
      <View style={styles.toggleIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      </View>
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

interface FeatureRowProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  description: string;
}

function FeatureRow({ icon, title, description }: FeatureRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <MaterialCommunityIcons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </View>
  );
}

const FIRST_RUN_STEPS = 4;

function StepProgress({ step }: { step: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      style={styles.progressRow}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step + 1} of ${FIRST_RUN_STEPS}`}
      accessibilityValue={{ min: 1, max: FIRST_RUN_STEPS, now: step + 1 }}
    >
      {Array.from({ length: FIRST_RUN_STEPS }, (_, index) => (
        <View key={index} style={[styles.progressDot, index <= step && styles.progressDotActive]} />
      ))}
    </View>
  );
}

export function OnboardingFlow({ initialStep = 0, onComplete }: OnboardingFlowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [step, setStep] = useState(initialStep);
  const [locationGranted, setLocationGranted] = useState(false);
  // Pre-fill from saved choices on re-consent. First-run starts with the
  // recommended defaults (all on) so the whole experience works out of the box.
  const [consent, setConsent] = useState<ConsentChoices>(() =>
    hasCompletedConsent() ? getConsentChoices() : getDefaultConsentChoices(),
  );
  const setViewport = useMapStore((s) => s.setViewport);
  const snoozeTakeoutReminder = useReviewImportStore((s) => s.snoozeTakeoutReminder);
  const router = useRouter();
  /** First-run starts at the welcome step; re-consent entries start later. */
  const isFirstRun = initialStep === 0;

  const updateConsent = useCallback((key: keyof ConsentChoices, value: boolean) => {
    setConsent((prev) => ({ ...prev, [key]: value }));
  }, []);

  const completeOnboarding = useCallback(() => {
    if (onComplete) {
      onComplete();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [onComplete, router]);

  const submitConsent = useCallback(async () => {
    let choices = consent;

    if (choices.locationEnabled) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationGranted(true);
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setViewport({ lat: loc.coords.latitude, lng: loc.coords.longitude, zoom: 12 });
        } catch {
          // Location unavailable — keep the default viewport.
        }
      } else {
        // The OS denied location, so reflect it in the choice the user sees.
        choices = { ...choices, locationEnabled: false };
        setConsent(choices);
      }
    }

    applyConsentChoices(choices);

    if (isFirstRun) setStep(2);
    else completeOnboarding();
  }, [consent, isFirstRun, completeOnboarding, setViewport]);

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
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <GlassView material="regular" style={styles.card}>
            {isFirstRun && <StepProgress step={step} />}
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="compass-outline" size={40} color={colors.primary} />
            </View>
            <Text style={styles.title}>Welcome to Polaris</Text>
            <Text style={styles.lead}>The map that belongs to everyone.</Text>
            <View style={styles.featureList}>
              <FeatureRow
                icon="map-marker-path"
                title="Navigate anywhere"
                description="Turn-by-turn directions, online or offline."
              />
              <FeatureRow
                icon="traffic-light"
                title="Live traffic, together"
                description="Nearby drivers share anonymous speeds."
              />
              <FeatureRow
                icon="shield-check-outline"
                title="No account. No ads."
                description="Your data stays yours."
              />
            </View>
            <Button title="Get started" onPress={() => setStep(1)} />
          </GlassView>
        )}

        {step === 1 && (
          <GlassView material="regular" style={styles.card}>
            {isFirstRun && <StepProgress step={step} />}
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="tune-variant" size={40} color={colors.primary} />
            </View>
            <Text style={styles.title}>You're in control</Text>
            <Text style={styles.lead}>
              These are on to give you the full experience. Turn off anything you'd rather keep
              private.
            </Text>
            <View style={styles.toggleList}>
              <ConsentToggle
                icon="crosshairs-gps"
                label="Location for Navigation"
                description="Center the map and guide your trips."
                value={consent.locationEnabled}
                onToggle={(v) => updateConsent('locationEnabled', v)}
              />
              <ConsentToggle
                icon="traffic-light"
                label="Traffic Telemetry"
                description="Share anonymous speeds to show live traffic."
                value={consent.trafficTelemetryEnabled}
                onToggle={(v) => updateConsent('trafficTelemetryEnabled', v)}
              />
              <ConsentToggle
                icon="map-marker-plus"
                label="Place Contributions"
                description="Add places, reviews, and corrections."
                value={consent.poiContributionsEnabled}
                onToggle={(v) => updateConsent('poiContributionsEnabled', v)}
              />
              <ConsentToggle
                icon="camera-outline"
                label="Street Imagery"
                description="Share photos with faces and plates blurred."
                value={consent.imagerySharingEnabled}
                onToggle={(v) => updateConsent('imagerySharingEnabled', v)}
              />
            </View>
            <Button title="Continue" onPress={submitConsent} />
            <Text style={styles.hint}>Change any of these anytime in Settings.</Text>
          </GlassView>
        )}

        {step === 2 && (
          <GlassView material="regular" style={styles.card}>
            {isFirstRun && <StepProgress step={step} />}
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="download-outline" size={40} color={colors.primary} />
            </View>
            <Text style={styles.title}>Take the map with you</Text>
            <Text style={styles.lead}>
              Download your area once, then navigate and search without a signal.
            </Text>
            <Text style={styles.body}>
              Map tiles, routing, and local search — ready before you lose signal. Download a region
              anytime from Profile → Manage Regions.
            </Text>
            {locationGranted && (
              <Text style={styles.hint}>We found you — nearby regions are suggested first.</Text>
            )}
            <Button title="Continue" onPress={afterRegions} />
          </GlassView>
        )}

        {step === 3 && (
          <GlassView material="regular" style={styles.card}>
            {isFirstRun && <StepProgress step={step} />}
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons
                name="map-marker-multiple-outline"
                size={40}
                color={colors.primary}
              />
            </View>
            <Text style={styles.title}>Keep your saved places</Text>
            <Text style={styles.lead}>Bring your Google Maps places and reviews with you.</Text>
            <View style={styles.stepList}>
              {TAKEOUT_ONBOARDING_STEPS.map((item, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{item}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.hint}>Google usually emails your export within a few hours.</Text>
            <Button title="Remind me tomorrow" onPress={remindMeLater} />
            <Button title="Maybe later" onPress={completeOnboarding} variant="ghost" />
          </GlassView>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
      padding: spacing.xl,
      gap: spacing.md,
      borderRadius: borderRadius.xl,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    progressDot: {
      width: 8,
      height: 8,
      borderRadius: borderRadius.round,
      backgroundColor: colors.border,
    },
    progressDotActive: {
      backgroundColor: colors.primary,
    },
    heroIcon: {
      alignSelf: 'center',
      width: 72,
      height: 72,
      borderRadius: borderRadius.round,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.primary}14`,
    },
    title: {
      ...typography.h1,
      color: colors.text,
      textAlign: 'center',
    },
    lead: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    body: {
      ...typography.bodySmall,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    hint: {
      ...typography.caption,
      color: colors.primary,
      textAlign: 'center',
    },
    featureList: {
      gap: spacing.md,
      marginVertical: spacing.xs,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    featureIcon: {
      width: 40,
      height: 40,
      borderRadius: borderRadius.round,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.primary}14`,
    },
    featureText: {
      flex: 1,
    },
    featureTitle: {
      ...typography.body,
      color: colors.text,
      fontWeight: '600',
    },
    featureDesc: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    toggleList: {
      marginVertical: spacing.xs,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    toggleIcon: {
      width: 36,
      height: 36,
      borderRadius: borderRadius.round,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.primary}14`,
    },
    toggleText: {
      flex: 1,
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
    stepList: {
      gap: spacing.sm,
      marginVertical: spacing.xs,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    stepNumber: {
      width: 26,
      height: 26,
      borderRadius: borderRadius.round,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.primary}14`,
    },
    stepNumberText: {
      ...typography.caption,
      color: colors.primary,
      fontWeight: '700',
    },
    stepText: {
      ...typography.bodySmall,
      color: colors.text,
      flex: 1,
    },
  });
