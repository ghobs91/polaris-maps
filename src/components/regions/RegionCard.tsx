import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { Region } from '../../models/region';

interface RegionCardProps {
  region: Region;
  onPress?: (region: Region) => void;
  onDownload?: (region: Region) => void;
  onDelete?: (region: Region) => void;
}

export function RegionCard({ region, onPress, onDownload, onDelete }: RegionCardProps) {
  const sizeMb = region.tilesSizeBytes
    ? Math.round(
        ((region.tilesSizeBytes ?? 0) +
          (region.routingSizeBytes ?? 0) +
          (region.geocodingSizeBytes ?? 0)) /
          (1024 * 1024),
      )
    : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onPress?.(region)}
      accessibilityRole="button"
      accessibilityLabel={region.name}
    >
      <View style={styles.header}>
        <Text style={styles.name}>{region.name}</Text>
        <StatusBadge status={region.downloadStatus} />
      </View>

      {sizeMb != null && <Text style={styles.size}>{sizeMb} MB</Text>}

      <View style={styles.actions}>
        {region.downloadStatus === 'none' && (
          <Pressable style={styles.actionBtn} onPress={() => onDownload?.(region)}>
            <Text style={styles.actionText}>Download</Text>
          </Pressable>
        )}
        {region.downloadStatus === 'complete' && (
          <Pressable
            style={[styles.actionBtn, styles.dangerBtn]}
            onPress={() => onDelete?.(region)}
          >
            <Text style={[styles.actionText, styles.dangerText]}>Delete</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
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
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
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
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  dangerBtn: { borderColor: colors.error },
  dangerText: { color: colors.error },
});
