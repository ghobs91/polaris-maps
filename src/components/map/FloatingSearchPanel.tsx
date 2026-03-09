import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  Keyboard,
  Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, borderRadius, shadow } from '../../constants/theme';
import { searchAddress, type GeocodingResult } from '../../services/geocoding/geocodingService';
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
} from '../../services/search/searchHistoryService';
import {
  getFavorites,
  setFavorite,
  type FavoriteLocation,
} from '../../services/favorites/favoritesService';
import { useMapStore } from '../../stores/mapStore';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type PanelMode = 'idle' | 'searching' | 'setting-home' | 'setting-work';

interface FloatingSearchPanelProps {
  /** Extra bottom offset so it doesn't overlap the locate button */
  bottomInsetExtra?: number;
}

// ─────────────────────────────────────────────
// Glass container — renders BlurView on iOS, semi-transparent on Android
// ─────────────────────────────────────────────
function GlassPanel({
  children,
  style,
  isDark,
}: {
  children: React.ReactNode;
  style?: object;
  isDark: boolean;
}) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={78}
        tint={isDark ? 'systemThickMaterialDark' : 'systemThickMaterial'}
        style={[styles.glassPanel, style]}
      >
        {children}
      </BlurView>
    );
  }
  return (
    <View
      style={[
        styles.glassPanel,
        {
          backgroundColor: isDark ? 'rgba(28,28,30,0.93)' : 'rgba(242,242,247,0.95)',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────
// Favorite pill/icon button
// ─────────────────────────────────────────────
interface FavChipProps {
  icon: string;
  label: string;
  iconBg: string;
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  unset?: boolean;
  isDark: boolean;
}

function FavChip({
  icon,
  label,
  iconBg,
  subtitle,
  onPress,
  onLongPress,
  unset,
  isDark,
}: FavChipProps) {
  const textColor = isDark ? '#F2F2F7' : '#1C1C1E';
  const subColor = isDark ? '#8E8E93' : '#8E8E93';

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      style={styles.favChip}
    >
      <View style={[styles.favIconCircle, { backgroundColor: iconBg, opacity: unset ? 0.55 : 1 }]}>
        <Ionicons name={icon as any} size={22} color="#fff" />
        {unset && (
          <View style={styles.favUnsetBadge}>
            <Ionicons name="add" size={10} color="#fff" />
          </View>
        )}
      </View>
      <Text style={[styles.favLabel, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
      {subtitle ? (
        <Text style={[styles.favSub, { color: subColor }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export function FloatingSearchPanel({ bottomInsetExtra = 0 }: FloatingSearchPanelProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setViewport = useMapStore((s) => s.setViewport);
  const setSelectedLocation = useMapStore((s) => s.setSelectedLocation);

  const [mode, setMode] = useState<PanelMode>('idle');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [history, setHistory] = useState<GeocodingResult[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);

  const inputRef = useRef<TextInput>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Load data on mount
  useEffect(() => {
    setHistory(getSearchHistory());
    setFavorites(getFavorites());
  }, []);

  // Animate results list in/out
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: mode !== 'idle' ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [mode, fadeAnim]);

  // ── Search ──────────────────────────────────
  const handleQueryChange = useCallback(async (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      const found = await searchAddress(text, 10);
      setResults(found);
    }, 320);
  }, []);

  const handleFocus = useCallback(() => {
    if (mode === 'idle') setMode('searching');
  }, [mode]);

  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    setMode('idle');
    setQuery('');
    setResults([]);
  }, []);

  // ── Selecting a result ──────────────────────
  const navigateToResult = useCallback(
    (result: GeocodingResult) => {
      setViewport({ lat: result.entry.lat, lng: result.entry.lng, zoom: 16 });
      setSelectedLocation({
        lat: result.entry.lat,
        lng: result.entry.lng,
        name: result.entry.text,
      });
    },
    [setViewport, setSelectedLocation],
  );

  const handleSelectResult = useCallback(
    (result: GeocodingResult) => {
      if (mode === 'setting-home') {
        const fav: FavoriteLocation = {
          id: 'home',
          kind: 'home',
          label: 'Home',
          entry: result.entry,
        };
        setFavorite(fav);
        setFavorites(getFavorites());
        dismissSearch();
        navigateToResult(result);
        return;
      }
      if (mode === 'setting-work') {
        const fav: FavoriteLocation = {
          id: 'work',
          kind: 'work',
          label: 'Work',
          entry: result.entry,
        };
        setFavorite(fav);
        setFavorites(getFavorites());
        dismissSearch();
        navigateToResult(result);
        return;
      }
      // Normal search selection
      addSearchHistory(result);
      setHistory(getSearchHistory());
      dismissSearch();
      navigateToResult(result);
    },
    [mode, dismissSearch, navigateToResult],
  );

  // ── Favorites shortcuts ──────────────────────
  const homeEntry = favorites.find((f) => f.kind === 'home');
  const workEntry = favorites.find((f) => f.kind === 'work');
  const pinnedEntries = favorites.filter((f) => f.kind === 'pin');

  const handleHomeTap = useCallback(() => {
    if (homeEntry) {
      navigateToResult({ entry: homeEntry.entry, rank: 0 });
    } else {
      setQuery('');
      setResults([]);
      setMode('setting-home');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [homeEntry, navigateToResult]);

  const handleWorkTap = useCallback(() => {
    if (workEntry) {
      navigateToResult({ entry: workEntry.entry, rank: 0 });
    } else {
      setQuery('');
      setResults([]);
      setMode('setting-work');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [workEntry, navigateToResult]);

  const handleHomeHold = useCallback(() => {
    if (!homeEntry) return;
    Alert.alert('Home', homeEntry.entry.text, [
      {
        text: 'Change Home',
        onPress: () => {
          setMode('setting-home');
          setTimeout(() => inputRef.current?.focus(), 80);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [homeEntry]);

  const handleWorkHold = useCallback(() => {
    if (!workEntry) return;
    Alert.alert('Work', workEntry.entry.text, [
      {
        text: 'Change Work',
        onPress: () => {
          setMode('setting-work');
          setTimeout(() => inputRef.current?.focus(), 80);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [workEntry]);

  // ── Derive placeholder ──────────────────────
  const placeholder = useMemo(() => {
    if (mode === 'setting-home') return 'Search for your home address…';
    if (mode === 'setting-work') return 'Search for your work address…';
    return 'Search';
  }, [mode]);

  // ── Styles ──────────────────────────────────
  const st = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const panelBottom = insets.bottom + 12 + bottomInsetExtra;
  const textColor = isDark ? '#F2F2F7' : '#1C1C1E';
  const subColor = '#8E8E93';

  // ── Render results list (search or history) ──
  const showResults = mode !== 'idle' && results.length > 0;
  const showHistory = mode === 'searching' && query.length < 2 && history.length > 0;

  const renderResultItem = useCallback(
    ({ item }: { item: GeocodingResult }) => (
      <TouchableOpacity
        style={st.resultRow}
        onPress={() => handleSelectResult(item)}
        activeOpacity={0.65}
      >
        <View style={st.resultIconWrap}>
          <Ionicons name="location-outline" size={18} color={colors.primary} />
        </View>
        <View style={st.resultText}>
          <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
            {item.entry.text}
          </Text>
          <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
            {[item.entry.city, item.entry.state, item.entry.country].filter(Boolean).join(', ')}
          </Text>
        </View>
        <Ionicons name="arrow-back" size={15} color={subColor} />
      </TouchableOpacity>
    ),
    [st, colors, textColor, subColor, handleSelectResult],
  );

  const renderHistoryItem = useCallback(
    ({ item }: { item: GeocodingResult }) => (
      <TouchableOpacity
        style={st.resultRow}
        onPress={() => handleSelectResult(item)}
        activeOpacity={0.65}
      >
        <View style={st.resultIconWrap}>
          <Ionicons name="time-outline" size={18} color={subColor} />
        </View>
        <View style={st.resultText}>
          <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
            {item.entry.text}
          </Text>
          <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
            {[item.entry.city, item.entry.state].filter(Boolean).join(', ')}
          </Text>
        </View>
        <TouchableOpacity
          hitSlop={10}
          onPress={() => {
            removeSearchHistory(item.entry.id);
            setHistory(getSearchHistory());
          }}
        >
          <Ionicons name="close-circle" size={18} color={subColor} />
        </TouchableOpacity>
      </TouchableOpacity>
    ),
    [st, textColor, subColor, handleSelectResult],
  );

  return (
    <View style={[styles.root, { bottom: panelBottom }]} pointerEvents="box-none">
      <GlassPanel isDark={isDark} style={st.panel}>
        {/* ── Handle bar ── */}
        <View style={styles.handle} />

        {/* ── Search row ── */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={subColor} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: textColor }]}
            value={query}
            onChangeText={handleQueryChange}
            onFocus={handleFocus}
            placeholder={placeholder}
            placeholderTextColor={subColor}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {mode !== 'idle' ? (
            <TouchableOpacity onPress={dismissSearch} hitSlop={10} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/profile')}
              activeOpacity={0.7}
              style={styles.profileBtn}
            >
              <View
                style={[styles.profileCircle, { backgroundColor: isDark ? '#3A3A3C' : '#D1D1D6' }]}
              >
                <Ionicons name="person" size={18} color={isDark ? '#EBEBF0' : '#3A3A3C'} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Results / history ── */}
        {(showResults || showHistory) && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={st.divider} />
            <FlatList
              data={showHistory ? history : results}
              keyExtractor={(item) => String(item.entry.id)}
              renderItem={showHistory ? renderHistoryItem : renderResultItem}
              keyboardShouldPersistTaps="handled"
              scrollEnabled
              style={st.resultList}
              ListHeaderComponent={
                showHistory ? (
                  <Text style={[st.sectionHeader, { color: subColor }]}>Recents</Text>
                ) : null
              }
            />
          </Animated.View>
        )}

        {/* ── Idle: Favorites + Recents ── */}
        {mode === 'idle' && (
          <>
            {/* Favorites row */}
            <View style={st.divider} />
            <View style={st.sectionHeaderRow}>
              <Text style={[st.sectionTitle, { color: textColor }]}>Places</Text>
              <Ionicons name="chevron-forward" size={15} color={subColor} />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.favRow}
            >
              <FavChip
                icon="home"
                label="Home"
                iconBg="#30C7E0"
                subtitle={homeEntry ? shorten(homeEntry.entry.text, 12) : undefined}
                onPress={handleHomeTap}
                onLongPress={handleHomeHold}
                unset={!homeEntry}
                isDark={isDark}
              />
              <FavChip
                icon="briefcase"
                label="Work"
                iconBg="#A47455"
                subtitle={workEntry ? shorten(workEntry.entry.text, 12) : undefined}
                onPress={handleWorkTap}
                onLongPress={handleWorkHold}
                unset={!workEntry}
                isDark={isDark}
              />
              {pinnedEntries.map((fav) => (
                <FavChip
                  key={fav.id}
                  icon="bookmark"
                  label={fav.label}
                  iconBg="#6246EA"
                  subtitle={shorten(fav.entry.text, 12)}
                  onPress={() => navigateToResult({ entry: fav.entry, rank: 0 })}
                  isDark={isDark}
                />
              ))}
            </ScrollView>

            {/* Recents */}
            {history.length > 0 && (
              <>
                <View style={st.divider} />
                <View style={st.sectionHeaderRow}>
                  <Text style={[st.sectionTitle, { color: textColor }]}>Recents</Text>
                  <Ionicons name="chevron-forward" size={15} color={subColor} />
                </View>
                {history.slice(0, 10).map((item) => (
                  <TouchableOpacity
                    key={item.entry.id}
                    style={st.recentRow}
                    onPress={() => handleSelectResult(item)}
                    activeOpacity={0.65}
                  >
                    <View style={st.recentIcon}>
                      <Ionicons name="time-outline" size={18} color={subColor} />
                    </View>
                    <View style={st.resultText}>
                      <Text style={[st.resultName, { color: textColor }]} numberOfLines={1}>
                        {item.entry.text}
                      </Text>
                      <Text style={[st.resultSub, { color: subColor }]} numberOfLines={1}>
                        {[item.entry.city, item.entry.state].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {/* Setting-home/work header when no results yet */}
        {(mode === 'setting-home' || mode === 'setting-work') && !showResults && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={st.divider} />
            <Text style={[st.settingHint, { color: subColor }]}>
              {mode === 'setting-home'
                ? 'Type your home address to save it'
                : 'Type your work address to save it'}
            </Text>
          </Animated.View>
        )}
      </GlassPanel>
    </View>
  );
}

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────
function shorten(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useTheme>['colors'], isDark: boolean) =>
  StyleSheet.create({
    panel: {
      ...shadow.lg,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
      marginHorizontal: spacing.md,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 2,
    },
    sectionTitle: {
      ...typography.subtitle,
      flex: 1,
    },
    sectionHeader: {
      ...typography.label,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    resultList: {
      maxHeight: 300,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    },
    resultIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    recentIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    resultText: {
      flex: 1,
      marginRight: spacing.xs,
    },
    resultName: {
      ...typography.body,
      fontWeight: '500',
    },
    resultSub: {
      ...typography.caption,
      marginTop: 1,
    },
    settingHint: {
      ...typography.bodySmall,
      textAlign: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
  });

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  glassPanel: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    // iOS shadow via shadow* props
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    // Android elevation
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,128,0.3)',
    marginTop: 8,
    marginBottom: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    fontSize: 17,
    paddingVertical: 4,
  },
  cancelBtn: {
    paddingLeft: spacing.sm,
  },
  cancelText: {
    ...typography.body,
    fontSize: 16,
  },
  profileBtn: {
    marginLeft: spacing.sm,
  },
  profileCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md - 4,
    paddingVertical: spacing.sm + 2,
    gap: 6,
  },
  favChip: {
    alignItems: 'center',
    width: 72,
    marginHorizontal: 4,
  },
  favIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
  },
  favUnsetBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#8E8E93',
    justifyContent: 'center',
    alignItems: 'center',
  },
  favLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  favSub: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 1,
  },
});
