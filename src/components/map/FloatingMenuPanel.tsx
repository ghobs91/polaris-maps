import React, { useEffect, useRef, useCallback, useState } from 'react';
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
import { usePeerStore } from '../../stores/peerStore';
import { joinNetwork, getLocalNode } from '../../services/sync/peerService';
import { startPeerMonitor, stopPeerMonitor } from '../../services/sync/peerMonitor';
import { NodeDashboard } from '../dashboard';
import { SettingsContent } from '../settings';
import { RegionsContent } from '../regions';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

const PANEL_WIDTH = 360;
const PANEL_GAP = spacing.md;

type PanelLayer = 'menu' | 'settings' | 'dashboard' | 'regions';

interface FloatingMenuPanelProps {
  visible: boolean;
  onClose: () => void;
  leftInset?: number;
  topInset?: number;
  bottomInset?: number;
}

export function FloatingMenuPanel({
  visible,
  onClose,
  leftInset = 0,
  topInset,
  bottomInset,
}: FloatingMenuPanelProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [layer, setLayer] = useState<PanelLayer>('menu');
  const [show, setShow] = useState(false);
  const menuSlideAnim = useRef(new Animated.Value(-PANEL_WIDTH - PANEL_GAP)).current;
  const detailSlideAnim = useRef(new Animated.Value(-PANEL_WIDTH - PANEL_GAP)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const { localNode, activePeers, syncingFeeds, isOnline, setLocalNode } = usePeerStore();
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
      Animated.timing(menuSlideAnim, {
        toValue: -PANEL_WIDTH - PANEL_GAP,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(detailSlideAnim, {
        toValue: -PANEL_WIDTH - PANEL_GAP,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShow(false);
      setLayer('menu');
      onClose();
    });
  }, [menuSlideAnim, detailSlideAnim, backdropAnim, onClose]);

  const navigateToLayer = useCallback(
    (nextLayer: PanelLayer) => {
      setLayer(nextLayer);
      detailSlideAnim.setValue(-PANEL_WIDTH - PANEL_GAP);
      Animated.spring(detailSlideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 2,
        speed: 15,
      }).start();
    },
    [detailSlideAnim],
  );

  const goBackToMenu = useCallback(() => {
    Animated.timing(detailSlideAnim, {
      toValue: -PANEL_WIDTH - PANEL_GAP,
      duration: 280,
      useNativeDriver: true,
    }).start(() => {
      setLayer('menu');
    });
  }, [detailSlideAnim]);

  // Animate open/close
  useEffect(() => {
    if (visible) {
      setShow(true);
      setLayer('menu');
      menuSlideAnim.setValue(-PANEL_WIDTH - PANEL_GAP);
      detailSlideAnim.setValue(-PANEL_WIDTH - PANEL_GAP);
      backdropAnim.setValue(0);
      loadNodeData();
      startPeerMonitor();
      Animated.parallel([
        Animated.spring(menuSlideAnim, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 3,
          speed: 14,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      stopPeerMonitor();
    }
  }, [visible, menuSlideAnim, detailSlideAnim, backdropAnim, loadNodeData]);

  if (!show) return null;

  const panelTop = topInset ?? insets.top + 50;
  const panelBottom = bottomInset ?? insets.bottom + spacing.md;
  const showingDetailLayer = layer !== 'menu';

  const pubkeyShort = localNode
    ? localNode.pubkey.slice(0, 8) + '\u2026' + localNode.pubkey.slice(-4)
    : '\u2014';

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={close}>
        <Animated.View pointerEvents="auto" style={[styles.backdrop, { opacity: backdropAnim }]} />
      </TouchableWithoutFeedback>

      {/* Primary floating panel */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.panel,
          {
            top: panelTop,
            bottom: panelBottom,
            width: PANEL_WIDTH,
            left: leftInset,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            transform: [{ translateX: menuSlideAnim }],
          },
        ]}
      >
        <View style={styles.panelFill}>
          <View style={styles.layerHeader}>
            <Text style={[styles.layerTitle, { color: colors.text }]}>Menu</Text>
            <TouchableOpacity onPress={close} hitSlop={12} style={styles.layerCloseBtn}>
              <View style={[styles.closeCircle, { backgroundColor: colors.border + '60' }]}>
                <Ionicons name="close" size={18} color={colors.text} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.menuContent}>
            <TouchableOpacity
              style={[styles.menuBtn, { borderColor: colors.border }]}
              onPress={() => navigateToLayer('settings')}
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
              style={[styles.menuBtn, { borderColor: colors.border }]}
              onPress={() => {
                loadNodeData();
                navigateToLayer('dashboard');
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
              style={[styles.menuBtn, { borderColor: colors.border }]}
              onPress={() => navigateToLayer('regions')}
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
        </View>
      </Animated.View>

      {/* Secondary floating panel */}
      {showingDetailLayer && (
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.panel,
            styles.panelSecondary,
            {
              top: panelTop,
              bottom: panelBottom,
              width: PANEL_WIDTH,
              left: leftInset + PANEL_WIDTH + PANEL_GAP,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              transform: [{ translateX: detailSlideAnim }],
            },
          ]}
        >
          <View style={styles.panelFill}>
            {layer === 'dashboard' && (
              <>
                <View style={styles.layerHeader}>
                  <Text style={[styles.layerTitle, { color: colors.text }]}>Node Dashboard</Text>
                  <TouchableOpacity
                    onPress={goBackToMenu}
                    hitSlop={12}
                    style={styles.layerCloseBtn}
                  >
                    <View style={[styles.closeCircle, { backgroundColor: colors.border + '60' }]}>
                      <Ionicons name="close" size={18} color={colors.text} />
                    </View>
                  </TouchableOpacity>
                </View>
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
            )}
            {(layer === 'settings' || layer === 'regions') && (
              <>
                <View style={styles.layerHeader}>
                  <Text style={[styles.layerTitle, { color: colors.text }]}>
                    {layer === 'settings' ? 'Settings' : 'Manage Regions'}
                  </Text>
                  <TouchableOpacity
                    onPress={goBackToMenu}
                    hitSlop={12}
                    style={styles.layerCloseBtn}
                  >
                    <View style={[styles.closeCircle, { backgroundColor: colors.border + '60' }]}>
                      <Ionicons name="close" size={18} color={colors.text} />
                    </View>
                  </TouchableOpacity>
                </View>
                {layer === 'settings' ? (
                  <SettingsContent showHeading={false} />
                ) : (
                  <RegionsContent showHeading={false} />
                )}
              </>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 30,
    overflow: 'hidden',
  },
  panelSecondary: {
    zIndex: 31,
    elevation: 31,
  },
  panelFill: {
    flex: 1,
  },
  layerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
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
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pubkey: {
    ...typography.caption,
    fontFamily: 'monospace',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  menuIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
});
