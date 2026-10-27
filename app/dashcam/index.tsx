import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Sharing from 'expo-sharing';
import { Button } from '../../src/components/common';
import { useTheme } from '../../src/contexts/ThemeContext';
import { spacing, typography } from '../../src/constants/theme';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { DashCamClip } from '../../src/models/dashCam';
import {
  deleteAllDashCamClips,
  deleteDashCamClip,
  listDashCamClips,
  reconcileDashCamClips,
} from '../../src/services/dashcam/dashCamQueue';
import { formatBytes } from '../../src/utils/formatBytes';

function formatClipLength(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatClipDate(startedAt: number): string {
  const date = new Date(startedAt);
  return `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * Review the rolling dash-cam buffer: play a clip, share it out of the app
 * (which also covers saving to Photos), or delete it to free space.
 */
export default function DashCamScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const maxMinutes = useSettingsStore((s) => s.dashCam.maxMinutes);
  const [clips, setClips] = useState<DashCamClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    await reconcileDashCamClips().catch(() => 0);
    const result = await listDashCamClips();
    setClips(result);
    setSelectedId((current) => (result.some((clip) => clip.id === current) ? current : null));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0] ?? null;

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
  });

  useEffect(() => {
    if (!selected) {
      player.pause();
      return;
    }
    player.replace(selected.localUri);
    player.play();
  }, [player, selected?.localUri]);

  const shareSelected = async () => {
    if (!selected) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'This device cannot share files.');
        return;
      }
      await Sharing.shareAsync(selected.localUri, {
        mimeType: 'video/mp4',
        UTI: 'public.mpeg-4',
        dialogTitle: 'Share dash cam clip',
      });
    } catch (error) {
      Alert.alert('Could not share clip', error instanceof Error ? error.message : String(error));
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    Alert.alert('Delete this clip?', 'The footage will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            player.pause();
            await deleteDashCamClip(selected);
            await load();
          })();
        },
      },
    ]);
  };

  const deleteAll = () => {
    Alert.alert('Delete all footage?', 'Every dash-cam clip on this device will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            player.pause();
            await deleteAllDashCamClips();
            await load();
          })();
        },
      },
    ]);
  };

  const totalBytes = clips.reduce((sum, clip) => sum + clip.bytes, 0);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : clips.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="videocam-off-outline" size={36} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>No dash cam footage</Text>
          <Text style={styles.emptyHint}>
            Start the dash cam from the navigation screen. It keeps the most recent {maxMinutes}{' '}
            minutes of footage and deletes the oldest clips automatically.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.playerBox}>
            <VideoView
              player={player}
              style={styles.video}
              contentFit="contain"
              nativeControls
              fullscreenOptions={{ enable: true }}
            />
          </View>
          <View style={styles.selectedRow}>
            <View style={styles.selectedText}>
              <Text style={styles.selectedTitle}>
                {selected ? formatClipDate(selected.startedAt) : ''}
              </Text>
              <Text style={styles.selectedMeta}>
                {selected
                  ? `${formatClipLength(selected.durationMs)} · ${formatBytes(selected.bytes)}`
                  : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => void shareSelected()}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Share clip"
            >
              <Ionicons name="share-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={deleteSelected}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Delete clip"
            >
              <Ionicons name="trash-outline" size={22} color={colors.error} />
            </Pressable>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summary}>
              {clips.length} clip{clips.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
            </Text>
            <Text style={styles.deleteAll} onPress={deleteAll} accessibilityRole="button">
              Delete all
            </Text>
          </View>

          <FlashList
            data={clips}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const active = item.id === selected?.id;
              return (
                <Pressable
                  onPress={() => setSelectedId(item.id)}
                  style={({ pressed }) => [
                    styles.clipRow,
                    active ? styles.clipRowActive : null,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Play clip from ${formatClipDate(item.startedAt)}`}
                >
                  <Ionicons
                    name={active ? 'play-circle' : 'videocam-outline'}
                    size={20}
                    color={active ? colors.primary : colors.textSecondary}
                  />
                  <View style={styles.clipText}>
                    <Text style={styles.clipTitle}>{formatClipDate(item.startedAt)}</Text>
                    <Text style={styles.clipMeta}>
                      {formatClipLength(item.durationMs)} · {formatBytes(item.bytes)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <View style={styles.footer}>
            <Button title="Share clip" variant="outline" onPress={() => void shareSelected()} />
          </View>
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
    },
    emptyTitle: { ...typography.h3, color: colors.text, fontSize: 17 },
    emptyHint: {
      ...typography.caption,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    playerBox: {
      backgroundColor: '#000',
      aspectRatio: 16 / 9,
      width: '100%',
    },
    video: { width: '100%', height: '100%' },
    selectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    selectedText: { flex: 1 },
    selectedTitle: { ...typography.body, color: colors.text, fontSize: 15, fontWeight: '600' },
    selectedMeta: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    summary: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
    deleteAll: { ...typography.caption, color: colors.error, fontSize: 13, paddingVertical: 6 },
    listContent: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
    clipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: 10,
    },
    clipRowActive: { backgroundColor: colors.primary + '1A' },
    clipText: { flex: 1 },
    clipTitle: { ...typography.body, color: colors.text, fontSize: 15 },
    clipMeta: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
    footer: { padding: spacing.md },
  });
