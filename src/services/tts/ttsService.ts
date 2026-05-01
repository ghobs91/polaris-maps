/**
 * Text-to-speech service for turn-by-turn voice guidance during active navigation.
 *
 * Wraps expo-speech (AVSpeechSynthesizer on iOS, TextToSpeech on Android) with
 * navigation-specific behaviour:
 * - One utterance at a time — calls stop() before speaking the next maneuver.
 * - Mutes when voiceGuidanceEnabled is toggled off in settings.
 * - No-ops gracefully on Web (expo-speech works on native only).
 * - Respects the user's device locale for voice selection.
 */

import { speak, stop, isSpeakingAsync } from 'expo-speech';
import { Platform } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';

/** The spoken text for the most recently queued maneuver. Used to avoid duplicate prompts. */
let lastSpokenText: string | null = null;

/**
 * Returns the user's locale string for speech voice selection (e.g. "en-US").
 * Defaults to "en-US" if locale detection fails.
 */
function getSpeechLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-US';
  }
}

/**
 * Speak a navigation instruction using the device TTS engine.
 *
 * If voice guidance is disabled in settings, this is a no-op.
 * If the same text was already spoken (e.g. duplicate maneuvers during reroute),
 * the call is skipped. Any currently-speaking utterance is stopped first so that
 * new instructions interrupt old ones.
 *
 * @param text  The speech-friendly instruction string (e.g. verbalPreTransition).
 *              Empty or whitespace-only strings are silently ignored.
 * @param language  Optional IETF BCP 47 language tag for voice selection.
 *                  Defaults to the device locale.
 */
export function speakInstruction(text: string, language?: string): void {
  if (Platform.OS === 'web') return;

  const trimmed = text.trim();
  if (!trimmed) return;

  const { voiceGuidanceEnabled } = useSettingsStore.getState();
  if (!voiceGuidanceEnabled) return;

  // Avoid speaking the same instruction twice in a row (can happen during
  // reroutes or GPS jitter that triggers repeated step advances).
  if (trimmed === lastSpokenText) return;
  lastSpokenText = trimmed;

  const locale = language ?? getSpeechLocale();

  // Stop any in-progress speech so the new instruction takes priority.
  // This matches the navigation pattern: new maneuver cancels old prompt.
  stop().then(() => {
    speak(trimmed, {
      language: locale,
      rate: 0.9, // Slightly slower than default for clarity while driving
      onDone: () => {
        lastSpokenText = null;
      },
      onError: () => {
        lastSpokenText = null;
      },
    });
  });
}

/**
 * Stop any currently-speaking utterance and clear the dedup state.
 *
 * Call this when navigation ends or when going off-route so stale prompts
 * don't play after the trip is over.
 */
export async function stopNavigationSpeech(): Promise<void> {
  if (Platform.OS === 'web') return;
  lastSpokenText = null;
  await stop();
}

/**
 * Returns true if the TTS engine is currently speaking.
 * Useful for UI indicators (e.g. a "mute" icon).
 */
export async function isSpeaking(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return isSpeakingAsync();
}
