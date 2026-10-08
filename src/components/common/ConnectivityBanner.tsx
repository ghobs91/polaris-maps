import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePeerStore } from '@/stores/peerStore';
import { getQueueSize } from '@/services/sync/offlineQueue';
import { useTheme } from '@/contexts/ThemeContext';
import { spacing, typography } from '@/constants/theme';
import { useThemedStyles, type Theme } from '@/hooks/useThemedStyles';

export function ConnectivityBanner() {
  const isOnline = usePeerStore((s) => s.isOnline);
  const [queued, setQueued] = useState(0);
  // Dismissed by the user for the current offline episode only; re-armed on
  // reconnect so the next drop is announced again.
  const [dismissed, setDismissed] = useState(false);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  useEffect(() => {
    if (!isOnline) {
      try {
        setQueued(getQueueSize());
      } catch {
        setQueued(0);
      }
    } else {
      setDismissed(false);
    }
  }, [isOnline]);

  if (isOnline || dismissed) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top + spacing.sm }]}>
      <Text style={styles.text}>
        You&apos;re offline — navigation and cached data are available. Live traffic, sync, and
        contributions are paused.
        {queued > 0
          ? ` ${queued} action${queued === 1 ? '' : 's'} queued (max 500) — replays on reconnect.`
          : ' Actions you take queue offline (max 500) and replay on reconnect.'}
      </Text>
      <Pressable
        onPress={() => setDismissed(true)}
        style={styles.dismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss offline notice"
        testID="connectivity-banner-dismiss"
      >
        <Ionicons name="close" size={18} color={colors.white} />
      </Pressable>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.warning,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    text: {
      flex: 1,
      ...typography.caption,
      color: colors.white,
      textAlign: 'center',
      fontWeight: '600',
    },
    dismiss: {
      marginLeft: spacing.sm,
      paddingTop: 2,
    },
  });
