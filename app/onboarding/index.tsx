import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

/**
 * Route entry for re-consent (opened from Settings). First-run gating renders
 * `OnboardingFlow` directly from the root layout before the tab stack mounts.
 * The `step` param lets Settings deep-link straight to the consent choices.
 */
export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ step?: string }>();
  const parsedStep = params.step != null ? Number(params.step) : 1;
  const initialStep = Number.isFinite(parsedStep) ? parsedStep : 1;

  return <OnboardingFlow initialStep={initialStep} />;
}
