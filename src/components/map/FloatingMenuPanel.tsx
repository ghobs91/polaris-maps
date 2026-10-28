import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableWithoutFeedback,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GlassView } from '../common/GlassView';
import { usePeerStore } from '../../stores/peerStore';
import { joinNetwork, getLocalNode } from '../../services/sync/peerService';
import { startPeerMonitor, stopPeerMonitor } from '../../services/sync/peerMonitor';
import { NodeDashboard } from '../dashboard';
import { SettingsContent } from '../settings';
import { RegionsContent } from '../regions';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

const PANEL_WIDTH = 360;

type PanelLayer = 'settings' | 'dashboard' | 'regions';

const LAYER_TITLES: Record<PanelLayer, string> = {
  settings: 'Settings',
  dashboard: 'Node Dashboard',
  regions: 'Manage Regions',
};

interface FloatingMenuPanelProps {
  visible: boolean;
  onClose: () => void;
  leftInset?: number;
  topInset?: number;
  bottomInset?: number;
}

/**
 * The single panel behind the map's settings button.
 *
 * Settings is the root layer; the node dashboard and the offline region
 * manager open from rows inside it instead of a separate launcher menu.
 */
export function FloatingMenuPanel({
  visible,
  onClose,
  leftInset = 0,
  topInset,
  bottomInset,
}: FloatingMenuPanelProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [layer, setLayer] = useState<PanelLayer>('settings');
  const [show, setShow] = useState(false);
  const slideAnim = useRef(new Animated.Value(-PANEL_WIDTH - spacing.md)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

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

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -PANEL_WIDTH - spacing.md,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShow(false);
      setLayer('settings');
      onClose();
    });
  }, [slideAnim, backdropAnim, onClose]);

  // Animate open and reset to the settings root each time.
  useEffect(() => {
    if (!visible) return;
    setShow(true);
    setLayer('settings');
    slideAnim.setValue(-PANEL_WIDTH - spacing.md);
    backdropAnim.setValue(0);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 2,
        speed: 16,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slideAnim, backdropAnim]);

  // The peer monitor only has to run while the dashboard is on screen.
  useEffect(() => {
    if (!show || layer !== 'dashboard') return;
    loadNodeData();
    startPeerMonitor();
    return () => {
      stopPeerMonitor();
    };
  }, [show, layer, loadNodeData]);

  if (!show) return null;

  const panelTop = topInset ?? insets.top + spacing.md;
  const panelBottom = bottomInset ?? insets.bottom + spacing.md;
  const pubkeyShort = localNode
    ? `${localNode.pubkey.slice(0, 8)}…${localNode.pubkey.slice(-4)}`
    : '—';

  return (
    <View style={styles.root} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={close}>
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]} pointerEvents="auto" />
      </TouchableWithoutFeedback>

      <Animated.View
        pointerEvents="auto"
        style={[
          styles.panel,
          {
            top: panelTop,
            bottom: panelBottom,
            width: PANEL_WIDTH,
            left: leftInset,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        <GlassView material="regular" style={styles.panelFill}>
          <View style={styles.layerHeader}>
            <View style={styles.headerLeft}>
              {layer !== 'settings' ? (
                <TouchableOpacity
                  onPress={() => setLayer('settings')}
                  hitSlop={12}
                  style={styles.layerCloseBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Back to settings"
                >
                  <Ionicons name="chevron-back" size={20} color={colors.text} />
                </TouchableOpacity>
              ) : null}
              <Text style={[styles.layerTitle, { color: colors.text }]}>{LAYER_TITLES[layer]}</Text>
            </View>
            <TouchableOpacity
              onPress={close}
              hitSlop={12}
              style={styles.layerCloseBtn}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <GlassView material="clear" isInteractive style={styles.closeCircle}>
                <Ionicons name="close" size={18} color={colors.text} />
              </GlassView>
            </TouchableOpacity>
          </View>

          {layer === 'settings' ? (
            <SettingsContent
              showHeading={false}
              onOpenRegions={() => setLayer('regions')}
              onOpenNodeDashboard={() => setLayer('dashboard')}
            />
          ) : null}

          {layer === 'dashboard' ? (
            <>
              <Text style={[styles.pubkey, { color: colors.textSecondary }]}>{pubkeyShort}</Text>
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
            </>
          ) : null}

          {layer === 'regions' ? <RegionsContent showHeading={false} /> : null}
        </GlassView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Above the search panel and the map content overlay, so the backdrop dims them. */
  root: {
    zIndex: 40,
    elevation: 40,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    position: 'absolute',
    left: 0,
  },
  panelFill: {
    flex: 1,
    borderRadius: borderRadius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  layerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  layerTitle: {
    ...typography.h2,
  },
  layerCloseBtn: {
    padding: spacing.xs,
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
  pubkey: {
    ...typography.caption,
    fontFamily: 'monospace',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
});
