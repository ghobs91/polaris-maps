import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BottomSheet } from '../common/BottomSheet';
import { GlassView } from '../common/GlassView';
import { usePeerStore } from '../../stores/peerStore';
import { joinNetwork, getLocalNode } from '../../services/sync/peerService';
import { startPeerMonitor, stopPeerMonitor } from '../../services/sync/peerMonitor';
import { NodeDashboard } from '../dashboard';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

const DRAWER_SNAP_POINTS = [0.78] as const;

interface NodeDashboardDrawerProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Node dashboard / menu drawer, built on the shared Reanimated bottom sheet
 * (replacing the legacy Animated + PanResponder implementation).
 */
export function NodeDashboardDrawer({ visible, onClose }: NodeDashboardDrawerProps) {
  const { colors } = useTheme();
  const router = useRouter();

  const [showDashboard, setShowDashboard] = useState(false);
  const localNode = usePeerStore((s) => s.localNode);
  const activePeers = usePeerStore((s) => s.activePeers);
  const syncingFeeds = usePeerStore((s) => s.syncingFeeds);
  const isOnline = usePeerStore((s) => s.isOnline);
  const setLocalNode = usePeerStore((s) => s.setLocalNode);
  const [refreshing, setRefreshing] = useState(false);

  const loadNodeData = useCallback(async () => {
    try {
      const node = await getLocalNode();
      setLocalNode(node);
    } catch {
      try {
        const node = await joinNetwork();
        setLocalNode(node);
      } catch {
        // Silently fail — will retry on pull-to-refresh
      }
    }
  }, [setLocalNode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNodeData();
    setRefreshing(false);
  }, [loadNodeData]);

  const handleClose = useCallback(() => {
    setShowDashboard(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      loadNodeData();
      startPeerMonitor();
    } else {
      stopPeerMonitor();
      setShowDashboard(false);
    }
  }, [visible, loadNodeData]);

  const pubkeyShort = localNode
    ? localNode.pubkey.slice(0, 8) + '…' + localNode.pubkey.slice(-4)
    : '—';

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      snapPoints={DRAWER_SNAP_POINTS}
      testID="node-dashboard-sheet"
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.heading, { color: colors.text }]}>
            {showDashboard ? 'Node Dashboard' : 'Menu'}
          </Text>
          {showDashboard && (
            <Text style={[styles.pubkey, { color: colors.textSecondary }]}>{pubkeyShort}</Text>
          )}
        </View>
        {showDashboard ? (
          <TouchableOpacity
            onPress={() => setShowDashboard(false)}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to menu"
          >
            <GlassView material="clear" isInteractive style={styles.closeCircle}>
              <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
            </GlassView>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          >
            <GlassView material="clear" isInteractive style={styles.closeCircle}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </GlassView>
          </TouchableOpacity>
        )}
      </View>

      {visible && showDashboard ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          <NodeDashboard
            node={localNode}
            activePeers={activePeers}
            syncingFeeds={syncingFeeds}
            isOnline={isOnline}
          />
        </ScrollView>
      ) : visible ? (
        <View style={styles.menuContent}>
          <TouchableOpacity
            style={[styles.menuBtn, { backgroundColor: colors.primary + '14' }]}
            onPress={() => {
              handleClose();
              router.push('/settings');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconCircle, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="settings-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.menuBtnText}>
              <Text style={[styles.menuBtnTitle, { color: colors.text }]}>Settings</Text>
              <Text style={[styles.menuBtnSub, { color: colors.textSecondary }]}>
                Resources, theme, permissions
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuBtn, { backgroundColor: colors.primary + '14' }]}
            onPress={() => {
              loadNodeData();
              setShowDashboard(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconCircle, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="pulse-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.menuBtnText}>
              <Text style={[styles.menuBtnTitle, { color: colors.text }]}>Node Dashboard</Text>
              <Text style={[styles.menuBtnSub, { color: colors.textSecondary }]}>
                Peers, feeds, network status
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuBtn, { backgroundColor: colors.primary + '14' }]}
            onPress={() => {
              handleClose();
              router.push('/regions');
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconCircle, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="map-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.menuBtnText}>
              <Text style={[styles.menuBtnTitle, { color: colors.text }]}>Manage Regions</Text>
              <Text style={[styles.menuBtnSub, { color: colors.textSecondary }]}>
                Download offline maps & routing
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  heading: {
    ...typography.h2,
    marginBottom: 2,
  },
  pubkey: {
    ...typography.caption,
    fontFamily: 'monospace',
  },
  closeBtn: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  menuContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
  },
  menuIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuBtnText: {
    flex: 1,
  },
  menuBtnTitle: {
    ...typography.body,
    fontWeight: '600',
  },
  menuBtnSub: {
    ...typography.caption,
    marginTop: 1,
  },
});
