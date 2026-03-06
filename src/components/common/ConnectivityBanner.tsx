import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePeerStore } from '@/stores/peerStore';
import { colors, spacing, typography } from '@/constants/theme';

export function ConnectivityBanner() {
  const isOnline = usePeerStore((s) => s.isOnline);

  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        You're offline — navigation and cached data are available. Live traffic, sync, and
        contributions are paused.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.white,
    textAlign: 'center',
    fontWeight: '600',
  },
});
