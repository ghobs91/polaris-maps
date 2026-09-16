/**
 * Text-to-speech service for turn-by-turn voice guidance during active navigation.
 *
 * Wraps expo-speech (AVSpeechSynthesizer on iOS, TextToSpeech on Android) with
 * navigation-specific behaviour:
 * - One utterance at a time — a new prompt cancels the previous one.
 * - Respects both the global voice setting and the in-navigation mute.
 * - Advance-distance prompt ladder (far → mid → near → now), deduped per maneuver.
 * - No-ops gracefully on Web (expo-speech works on native only).
 * - Respects the user's device locale for voice selection.
 */

import { speak, stop, isSpeakingAsync } from 'expo-speech';
import { Platform } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { formatDistance } from '../../utils/units';
import { VoiceAnnouncementTracker, announcementText, type Announcement } from './voiceGuidance';

/** The spoken text for the most recently queued prompt. Used to avoid duplicate prompts. */
let lastSpokenText: string | null = null;
/** The most recent maneuver announcement, for the in-navigation repeat control. */
let lastAnnouncementText: string | null = null;

const tracker = new VoiceAnnouncementTracker();

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

/** True when guidance is enabled globally and not muted for this trip. */
function canSpeak(): boolean {
  if (Platform.OS === 'web') return false;
  const { voiceGuidanceEnabled } = useSettingsStore.getState();
  const { muted } = useNavigationStore.getState();
  return voiceGuidanceEnabled && !muted;
}

/**
 * Speak a navigation instruction using the device TTS engine.
 *
 * No-ops when guidance is disabled or muted. Skips text identical to the last
 * spoken prompt (guards against duplicate maneuvers during reroutes). Any
 * in-progress utterance is stopped first so new instructions take priority.
 *
 * @param text  The speech-friendly instruction string (e.g. verbalPreTransition).
 * @param language  Optional IETF BCP 47 language tag. Defaults to the device locale.
 */
export function speakInstruction(text: string, language?: string): void {
  if (!canSpeak()) return;

  const trimmed = text.trim();
  if (!trimmed) return;

  if (trimmed === lastSpokenText) return;
  lastSpokenText = trimmed;

  const locale = language ?? getSpeechLocale();

  stop()
    .then(() => {
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
    })
    .catch(() => {
      lastSpokenText = null;
    });
}

/**
 * Announce an upcoming maneuver through the distance ladder. Each band fires at
 * most once per maneuver; the tracker resets automatically when `maneuverKey`
 * changes.
 */
export function announceManeuver(
  maneuverKey: string,
  distanceMeters: number,
  instruction: string,
): void {
  const next: Announcement | null = tracker.next(maneuverKey, distanceMeters);
  if (!next) return;

  const text = announcementText(next.band, next.distanceMeters, instruction, formatDistance);
  if (!text) return;

  lastAnnouncementText = text;
  speakInstruction(text);
}

/** Re-speak the last maneuver prompt (in-navigation "repeat"). */
export function repeatLastAnnouncement(): void {
  if (!lastAnnouncementText) return;
  lastSpokenText = null;
  speakInstruction(lastAnnouncementText);
}

/** Announce the start of a navigation session and reset the prompt ladder. */
export function announceNavigationStart(destinationName?: string): void {
  resetAnnouncements();
  lastSpokenText = null;
  speakInstruction(
    destinationName ? `Starting navigation to ${destinationName}` : 'Starting navigation',
  );
}

/** Announce that the vehicle has left the route and is rerouting. */
export function announceOffRoute(): void {
  speakInstruction('Off route. Rerouting.');
}

/** Announce that a new route is ready, and reset the ladder for the new maneuvers. */
export function announceRerouted(): void {
  resetAnnouncements();
  speakInstruction('Rerouted. Continue to the next turn.');
}

/** Announce arrival at the destination. */
export function announceArrival(destinationName?: string): void {
  speakInstruction(destinationName ? `You have arrived at ${destinationName}` : 'You have arrived');
}

/** Clear per-maneuver prompt state (call on reroute or new route). */
export function resetAnnouncements(): void {
  tracker.reset();
  lastAnnouncementText = null;
}

/**
 * Stop any currently-speaking utterance and clear dedup state.
 * Call this when navigation ends or when going off-route.
 */
export async function stopNavigationSpeech(): Promise<void> {
  if (Platform.OS === 'web') return;
  lastSpokenText = null;
  lastAnnouncementText = null;
  tracker.reset();
  await stop();
}

/** Returns true if the TTS engine is currently speaking. */
export async function isSpeaking(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return isSpeakingAsync();
}
