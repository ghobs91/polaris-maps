import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePeerStore } from '../../src/stores/peerStore';
import { joinNetwork, getLocalNode } from '../../src/services/sync/peerService';
import { getActiveFeeds } from '../../src/services/sync/feedSyncService';
import { NodeDashboard } from '../../src/components/dashboard';
import { Button, ErrorBoundary } from '../../src/components/common';
import { spacing, typography } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { localNode, activePeers, syncingFeeds, isOnline, setLocalNode, setSyncingFeeds } =
    usePeerStore();
  const [refreshing, setRefreshing] = React.useState(false);

  const loadNodeData = useCallback(async () => {
    try {
      const node = await getLocalNode();
      setLocalNode(node);
      setSyncingFeeds(getActiveFeeds().length);
    } catch {
      // Node not joined yet — auto-join
      try {
        const node = await joinNetwork();
        setLocalNode(node);
      } catch {
        // Silently fail — will retry on refresh
      }
    }
  }, [setLocalNode, setSyncingFeeds]);

  useEffect(() => {
    loadNodeData();
  }, [loadNodeData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNodeData();
    setRefreshing(false);
  }, [loadNodeData]);

  const pubkeyShort = localNode
    ? localNode.pubkey.slice(0, 8) + '…' + localNode.pubkey.slice(-4)
    : '—';

  return (
    <ErrorBoundary>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.heading}>Node Dashboard</Text>
        <Text style={styles.pubkey}>{pubkeyShort}</Text>

        <NodeDashboard
          node={localNode}
          activePeers={activePeers}
          syncingFeeds={syncingFeeds}
          isOnline={isOnline}
        />

        <View style={styles.actions}>
          <Button title="Settings" onPress={() => router.push('/settings')} variant="outline" />
          <Button
            title="Manage Regions"
            onPress={() => router.push('/regions')}
            variant="outline"
          />
        </View>
      </ScrollView>
    </ErrorBoundary>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },
    heading: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
    pubkey: {
      ...typography.caption,
      color: colors.textSecondary,
      fontFamily: 'monospace',
      marginBottom: spacing.lg,
    },
    actions: { marginTop: spacing.xl, gap: spacing.sm },
  });
