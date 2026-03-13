import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableWithoutFeedback,
  Dimensions,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { usePeerStore } from '../../stores/peerStore';
import { joinNetwork, getLocalNode } from '../../services/sync/peerService';
import { getActiveFeeds } from '../../services/sync/feedSyncService';
import { NodeDashboard } from '../dashboard';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_HEIGHT = SCREEN_HEIGHT * 0.78;
const DISMISS_THRESHOLD = DRAWER_HEIGHT * 0.25;

interface NodeDashboardDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function NodeDashboardDrawer({ visible, onClose }: NodeDashboardDrawerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [show, setShow] = useState(false);
  const translateY = useRef(new Animated.Value(DRAWER_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const { localNode, activePeers, syncingFeeds, isOnline, setLocalNode, setSyncingFeeds } =
    usePeerStore();
  const [refreshing, setRefreshing] = useState(false);

  const loadNodeData = useCallback(async () => {
    try {
      const node = await getLocalNode();
      setLocalNode(node);
      setSyncingFeeds(getActiveFeeds().length);
    } catch {
      try {
        const node = await joinNetwork();
        setLocalNode(node);
      } catch {
        // Silently fail — will retry on pull-to-refresh
      }
    }
  }, [setLocalNode, setSyncingFeeds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNodeData();
    setRefreshing(false);
  }, [loadNodeData]);

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: DRAWER_HEIGHT,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShow(false);
      onClose();
    });
  }, [translateY, backdropOpacity, onClose]);

  // Keep a ref so the PanResponder always calls the latest close()
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 5 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          translateY.setValue(gs.dy);
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.5) {
          closeRef.current();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
    }),
  ).current;

  // Animate open when visible becomes true
  useEffect(() => {
    if (visible) {
      setShow(true);
      translateY.setValue(DRAWER_HEIGHT);
      backdropOpacity.setValue(0);
      loadNodeData();
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 3,
          speed: 14,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, backdropOpacity, loadNodeData]);

  if (!show) return null;

  const pubkeyShort = localNode
    ? localNode.pubkey.slice(0, 8) + '…' + localNode.pubkey.slice(-4)
    : '—';

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={close}>
        <Animated.View
          pointerEvents="auto"
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            paddingBottom: insets.bottom + spacing.md,
            transform: [{ translateY }],
          },
        ]}
      >
        {/* Drag handle — the only area that triggers the pan gesture */}
        <View {...panResponder.panHandlers} style={styles.handleArea}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.heading, { color: colors.text }]}>Node Dashboard</Text>
            <Text style={[styles.pubkey, { color: colors.textSecondary }]}>{pubkeyShort}</Text>
          </View>
          <TouchableOpacity onPress={close} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Scrollable content */}
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

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: colors.border }]}
              onPress={() => {
                close();
                router.push('/settings');
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="settings-outline" size={16} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: colors.border }]}
              onPress={() => {
                close();
                router.push('/regions');
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="map-outline" size={16} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Manage Regions</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: DRAWER_HEIGHT,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 24,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  actionText: {
    ...typography.body,
  },
});
