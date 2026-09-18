import { useCallback, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

export interface UseVoiceSearchOptions {
  /** Called with the final transcript when recognition succeeds. */
  onTranscript: (transcript: string) => void;
  lang?: string;
}

export interface UseVoiceSearchResult {
  isListening: boolean;
  /** False once permission was denied or the recognizer failed to start. */
  isAvailable: boolean;
  start: () => Promise<boolean>;
  stop: () => void;
  toggle: () => Promise<void>;
}

/**
 * Voice search built on `expo-speech-recognition` (the same implementation the
 * SearchBar uses). Permission is requested just-in-time; when it is denied or
 * the recognizer is unavailable the hook reports `isAvailable === false` so the
 * caller can fall back to the keyboard.
 */
export function useVoiceSearch({
  onTranscript,
  lang = 'en-US',
}: UseVoiceSearchOptions): UseVoiceSearchResult {
  const [isListening, setIsListening] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    if (transcript) onTranscript(transcript);
    setIsListening(false);
  });

  useSpeechRecognitionEvent('error', () => setIsListening(false));
  useSpeechRecognitionEvent('end', () => setIsListening(false));

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!granted) {
        const { granted: requested } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!requested) {
          setIsAvailable(false);
          return false;
        }
      }
    } catch {
      setIsAvailable(false);
      return false;
    }

    setIsListening(true);
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        iosTaskHint: 'search',
      });
      return true;
    } catch {
      setIsListening(false);
      setIsAvailable(false);
      return false;
    }
  }, [lang]);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Recognizer not running — nothing to stop.
    }
    setIsListening(false);
  }, []);

  const toggle = useCallback(async () => {
    if (isListening) {
      stop();
      return;
    }
    await start();
  }, [isListening, start, stop]);

  return { isListening, isAvailable, start, stop, toggle };
}
