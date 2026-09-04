import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePeerStore } from '@/stores/peerStore';
import { getQueueSize } from '@/services/sync/offlineQueue';
import { colors, spacing, typography } from '@/constants/theme';

export function ConnectivityBanner() {
  const isOnline = usePeerStore((s) => s.isOnline);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if (!isOnline) {
      try {
        setQueued(getQueueSize());
      } catch {
        setQueued(0);
      }
    }
  }, [isOnline]);

  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        You&apos;re offline — navigation and cached data are available. Live traffic, sync, and
        contributions are paused.
        {queued > 0
          ? ` ${queued} action${queued === 1 ? '' : 's'} queued (max 500) — replays on reconnect.`
          : ' Actions you take queue offline (max 500) and replay on reconnect.'}
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
