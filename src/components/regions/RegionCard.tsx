import React from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { Region } from '../../models/region';

interface RegionCardProps {
  region: Region;
  onPress?: (region: Region) => void;
  onDownload?: (region: Region) => void;
  onCancel?: (region: Region) => void;
  onDelete?: (region: Region) => void;
}

export function RegionCard({ region, onPress, onDownload, onCancel, onDelete }: RegionCardProps) {
  const sizeMb = region.tilesSizeBytes
    ? Math.round(
        ((region.tilesSizeBytes ?? 0) +
          (region.routingSizeBytes ?? 0) +
          (region.geocodingSizeBytes ?? 0)) /
          (1024 * 1024),
      )
    : null;

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardBody, pressed && onPress && styles.pressed]}
        onPress={() => onPress?.(region)}
        accessibilityRole={onPress ? 'button' : 'none'}
        accessibilityLabel={region.name}
      >
        <View style={styles.header}>
          <Text style={styles.name}>{region.name}</Text>
          <StatusBadge status={region.downloadStatus} />
        </View>

        {sizeMb != null && <Text style={styles.size}>{sizeMb} MB</Text>}
      </Pressable>

      <View style={styles.actions}>
        {region.downloadStatus === 'none' && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onDownload?.(region)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>Download</Text>
          </TouchableOpacity>
        )}
        {region.downloadStatus === 'downloading' && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.cancelBtn]}
            onPress={() => onCancel?.(region)}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionText, styles.cancelText]}>Cancel</Text>
          </TouchableOpacity>
        )}
        {region.downloadStatus === 'failed' && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.retryBtn]}
            onPress={() => onDownload?.(region)}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionText, styles.retryText]}>Retry</Text>
          </TouchableOpacity>
        )}
        {region.downloadStatus === 'complete' && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.dangerBtn]}
            onPress={() => onDelete?.(region)}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionText, styles.dangerText]}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function StatusBadge({ status }: { status: Region['downloadStatus'] }) {
  const color =
    status === 'complete'
      ? colors.success
      : status === 'downloading'
        ? colors.warning
        : status === 'failed'
          ? colors.error
          : colors.textSecondary;

  const label =
    status === 'complete'
      ? 'Downloaded'
      : status === 'downloading'
        ? 'Downloading…'
        : status === 'failed'
          ? 'Failed'
          : 'Available';

  return (
    <View style={[styles.badge, { backgroundColor: color + '20' }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardBody: {
    padding: spacing.md,
    paddingBottom: 0,
  },
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  name: { ...typography.subtitle, color: colors.text, flex: 1 },
  size: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  badge: { borderRadius: borderRadius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { ...typography.caption, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.sm },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  retryBtn: { borderColor: colors.warning },
  retryText: { color: colors.warning },
  dangerBtn: { borderColor: colors.error },
  dangerText: { color: colors.error },
  cancelBtn: { borderColor: colors.textSecondary },
  cancelText: { color: colors.textSecondary },
});
