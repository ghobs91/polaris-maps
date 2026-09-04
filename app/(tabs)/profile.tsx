import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePeerStore } from '../../src/stores/peerStore';
import { joinNetwork, getLocalNode } from '../../src/services/sync/peerService';
import { startPeerMonitor, stopPeerMonitor } from '../../src/services/sync/peerMonitor';
import { NodeDashboard } from '../../src/components/dashboard';
import { Button, ErrorBoundary } from '../../src/components/common';
import { spacing, typography } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const localNode = usePeerStore((s) => s.localNode);
  const activePeers = usePeerStore((s) => s.activePeers);
  const syncingFeeds = usePeerStore((s) => s.syncingFeeds);
  const isOnline = usePeerStore((s) => s.isOnline);
  const setLocalNode = usePeerStore((s) => s.setLocalNode);
  const [refreshing, setRefreshing] = React.useState(false);

  const loadNodeData = useCallback(async () => {
    try {
      const node = await getLocalNode();
      setLocalNode(node);
    } catch {
      try {
        const node = await joinNetwork();
        setLocalNode(node);
      } catch {
        // Silently fail — will retry on refresh
      }
    }
  }, [setLocalNode]);

  useEffect(() => {
    loadNodeData();
    startPeerMonitor();
    return () => {
      stopPeerMonitor();
    };
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
        <Text style={styles.pubkey} selectable>
          {localNode ? localNode.pubkey : pubkeyShort}
        </Text>
        <Text style={styles.identityHint}>
          No accounts — this secp256k1 key in your secure enclave is your identity. Actions are
          Schnorr-signed; reputation builds from contributions.
        </Text>

        <NodeDashboard
          node={localNode}
          activePeers={activePeers}
          syncingFeeds={syncingFeeds}
          isOnline={isOnline}
        />

        <View style={styles.actions}>
          <Button
            title="Settings"
            onPress={() => router.push('/settings')}
            variant="outline"
            style={{ borderCurve: 'continuous' }}
          />
          <Button
            title="Manage Regions"
            onPress={() => router.push('/regions')}
            variant="outline"
            style={{ borderCurve: 'continuous' }}
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
      marginBottom: spacing.xs,
    },
    identityHint: {
      ...typography.caption,
      color: colors.textSecondary,
      marginBottom: spacing.lg,
    },
    actions: { marginTop: spacing.xl, gap: spacing.sm },
  });
