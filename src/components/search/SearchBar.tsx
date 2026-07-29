import React, { useState, useCallback } from 'react';
import { TextInput, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { colors, spacing, typography } from '../../constants/theme';
import { GlassView } from '../common/GlassView';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export function SearchBar({ onSearch, placeholder = 'Search for an address...' }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      onSearch(text);
    },
    [onSearch],
  );

  // Handle speech recognition results
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    if (transcript) {
      setQuery(transcript);
      onSearch(transcript);
    }
    setIsListening(false);
  });

  useSpeechRecognitionEvent('error', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  const toggleVoiceSearch = useCallback(async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
      return;
    }

    try {
      const { granted } = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!granted) {
        const { granted: requested } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!requested) return;
      }
    } catch {
      return;
    }

    setQuery('');
    setIsListening(true);

    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        iosTaskHint: 'search',
      });
    } catch {
      setIsListening(false);
    }
  }, [isListening]);

  return (
    <View style={styles.container}>
      <GlassView material="regular" style={styles.inputContainer}>
        <Ionicons name="search" size={18} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          placeholder={isListening ? 'Listening...' : placeholder}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search"
          accessibilityHint="Type an address, place name, or category to search"
        />
        <TouchableOpacity
          onPress={toggleVoiceSearch}
          style={[styles.micButton, isListening && styles.micButtonActive]}
          activeOpacity={0.7}
          accessibilityLabel={isListening ? 'Stop voice search' : 'Voice search'}
          accessibilityHint="Tap to search by voice"
          accessibilityRole="button"
        >
          <Ionicons
            name={isListening ? 'mic' : 'mic-outline'}
            size={20}
            color={isListening ? colors.error : colors.textSecondary}
          />
        </TouchableOpacity>
      </GlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    overflow: 'hidden',
    borderCurve: 'continuous',
    paddingHorizontal: spacing.sm,
  },
  searchIcon: {
    paddingLeft: spacing.md,
  },
  input: {
    ...typography.body,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: 'hidden',
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.xs,
  },
  micButtonActive: {
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
});
