import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigationStore } from '../../stores/navigationStore';
import { noteFasterRouteDismissed } from '../../services/traffic/rerouteService';
import { formatETA } from '../../utils/etaCalculator';
import { nav } from '../../constants/theme';

/**
 * Non-blocking prompt offering a traffic-aware alternative that is
 * significantly faster than the active route. The active route is never
 * replaced until the user accepts here — see the faster-route monitor in
 * `services/traffic/rerouteService`.
 */
export function FasterRouteBanner() {
  const suggestion = useNavigationStore((s) => s.fasterRouteSuggestion);
  const acceptFasterRoute = useNavigationStore((s) => s.acceptFasterRoute);
  const dismissFasterRoute = useNavigationStore((s) => s.dismissFasterRoute);

  if (!suggestion) return null;

  const saved = formatETA(suggestion.savingSeconds);

  const handleAccept = () => {
    acceptFasterRoute();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleDismiss = () => {
    dismissFasterRoute();
    // Cool down so the same suggestion does not immediately reappear.
    noteFasterRouteDismissed();
  };

  return (
    <View
      style={styles.banner}
      accessibilityRole="alert"
      accessibilityLabel={`Faster route available, saves ${saved}`}
    >
      <Ionicons name="trending-up" size={16} color={nav.accent} />
      <Text style={styles.text} numberOfLines={1}>
        Faster route · save {saved}
      </Text>
      <TouchableOpacity
        style={styles.accept}
        onPress={handleAccept}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Take the faster route"
      >
        <Text style={styles.acceptText}>Take it</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismiss}
        onPress={handleDismiss}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Dismiss faster route suggestion"
        hitSlop={8}
      >
        <Ionicons name="close" size={16} color={nav.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: nav.accentWash,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  text: {
    flexShrink: 1,
    color: nav.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  accept: {
    backgroundColor: nav.accent,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  acceptText: {
    color: nav.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  dismiss: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
