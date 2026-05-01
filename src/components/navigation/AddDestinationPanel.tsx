import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { unifiedSearch, type UnifiedSearchResult } from '../../services/search/unifiedSearch';
import { spacing } from '../../constants/theme';

interface AddDestinationPanelProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: UnifiedSearchResult) => void;
  searchCenter: { lat: number; lng: number };
}

export function AddDestinationPanel({
  visible,
  onClose,
  onSelect,
  searchCenter,
}: AddDestinationPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate panel in/out
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  // Handle speech recognition events
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    if (transcript) {
      setQuery(transcript);
      performSearch(transcript);
    }
    setIsListening(false);
  });

  useSpeechRecognitionEvent('error', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  const checkPermissions = useCallback(async () => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!granted) {
        const { granted: requested } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        return requested;
      }
      return granted;
    } catch {
      return false;
    }
  }, []);

  const toggleVoiceSearch = useCallback(async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
      return;
    }

    const granted = await checkPermissions();
    if (!granted) return;

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
  }, [isListening, checkPermissions]);

  const performSearch = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const searchResults = await unifiedSearch(text, {
          lat: searchCenter.lat,
          lng: searchCenter.lng,
          zoom: 14,
          limit: 8,
          userLocation: searchCenter,
        });
        setResults(searchResults);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [searchCenter],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        performSearch(text);
      }, 350);
    },
    [performSearch],
  );

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
    }
    onClose();
  }, [onClose, isListening]);

  const handleSelect = useCallback(
    (result: UnifiedSearchResult) => {
      Keyboard.dismiss();
      if (isListening) {
        ExpoSpeechRecognitionModule.stop();
        setIsListening(false);
      }
      onSelect(result);
      setQuery('');
      setResults([]);
    },
    [onSelect, isListening],
  );

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <Animated.View style={[styles.panel, { transform: [{ translateY }] }]}>
          {/* Drag handle */}
          <View style={styles.dragHandle} />

          {/* Search row */}
          <View style={styles.searchRow}>
            <View style={styles.searchInputContainer}>
              <Ionicons
                name="search"
                size={18}
                color="rgba(255,255,255,0.5)"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={handleChangeText}
                placeholder="Where to?"
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoFocus={visible}
                autoCorrect={false}
                returnKeyType="search"
                selectionColor="#409CFF"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setQuery('');
                    setResults([]);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.micButton, isListening && styles.micButtonActive]}
              onPress={toggleVoiceSearch}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isListening ? 'mic' : 'mic-outline'}
                size={22}
                color={isListening ? '#EF4444' : '#fff'}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {isListening && (
            <View style={styles.listeningBanner}>
              <ActivityIndicator color="#409CFF" />
              <Text style={styles.listeningText}>Listening...</Text>
            </View>
          )}

          {loading && !isListening && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#409CFF" />
            </View>
          )}

          {!loading && results.length === 0 && query.trim().length >= 2 && !isListening && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No results found</Text>
            </View>
          )}

          {results.length > 0 && (
            <FlatList
              data={results}
              keyExtractor={(item, index) => `${item.lat}-${item.lng}-${index}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.6}
                >
                  <View style={styles.resultIcon}>
                    <Ionicons name="location-outline" size={20} color="#409CFF" />
                  </View>
                  <View style={styles.resultTextContainer}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.resultSubtitle} numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              style={styles.resultsList}
            />
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  keyboardAvoid: {
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
    maxHeight: '75%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    height: 44,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonActive: {
    backgroundColor: 'rgba(239,68,68,0.2)',
  },
  cancelText: {
    color: '#409CFF',
    fontSize: 16,
    fontWeight: '500',
  },
  listeningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  listeningText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
  },
  resultsList: {
    maxHeight: 380,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(64,156,255,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  resultName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  resultSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 48,
  },
});
