import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MetricCard } from './MetricCard';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../common/GlassView';
import type { PeerNode } from '../../models/peer';

interface NodeDashboardProps {
  node: PeerNode | null;
  activePeers: number;
  syncingFeeds: number;
  isOnline: boolean;
}

export function NodeDashboard({ node, activePeers, syncingFeeds, isOnline }: NodeDashboardProps) {
  const { colors } = useTheme();
  const uptimeHours = node ? Math.floor(node.uptimeSeconds / 3600) : 0;
  const dataServedMb = node ? Math.round(node.dataServedBytes / (1024 * 1024)) : 0;
  const cacheSizeMb = node ? Math.round(node.cacheSizeBytes / (1024 * 1024)) : 0;
  const regionsCount = node?.regionIds.length ?? 0;

  return (
    <GlassView material="regular" style={styles.container}>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            isOnline ? { backgroundColor: colors.success } : { backgroundColor: colors.error },
          ]}
        />
        <Text style={[styles.statusText, { color: colors.text }]}>
          {isOnline ? 'Connected' : 'Offline'}
        </Text>
      </View>

      <View style={styles.metricsRow}>
        <MetricCard label="Active Peers" value={activePeers} />
        <MetricCard label="Syncing Feeds" value={syncingFeeds} />
      </View>

      <View style={styles.metricsRow}>
        <MetricCard label="Data Served" value={dataServedMb} unit="MB" />
        <MetricCard label="Cache Size" value={cacheSizeMb} unit="MB" />
      </View>

      <View style={styles.metricsRow}>
        <MetricCard label="Uptime" value={uptimeHours} unit="hrs" />
        <MetricCard label="Regions" value={regionsCount} />
      </View>

      <Text style={[styles.explainer, { color: colors.textSecondary }]}>
        Every phone is a node, not just a client — you seed map tiles, traffic probes, places, and
        imagery to nearby peers over an encrypted P2P mesh.
      </Text>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderCurve: 'continuous',
    padding: spacing.md,
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.xs,
  },
  statusText: {
    ...typography.body,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  explainer: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
});
