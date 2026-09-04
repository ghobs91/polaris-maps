import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { Region } from '../../models/region';

interface RegionCardProps {
  region: Region;
  onPress?: (region: Region) => void;
  onDownload?: (region: Region) => void;
  onCancel?: (region: Region) => void;
  onDelete?: (region: Region) => void;
  /** Whether a newer tile version is available from OpenFreeMap. */
  updateAvailable?: boolean;
}

export const RegionCard = memo(function RegionCard({
  region,
  onPress,
  onDownload,
  onCancel,
  onDelete,
  updateAvailable,
}: RegionCardProps) {
  const toMb = (b?: number | null) =>
    ((b ?? 0) / (1024 * 1024)).toFixed(b && b >= 10 * 1024 * 1024 ? 0 : 1);
  const sizeMb = region.tilesSizeBytes
    ? Math.round(
        ((region.tilesSizeBytes ?? 0) +
          (region.routingSizeBytes ?? 0) +
          (region.geocodingSizeBytes ?? 0)) /
          (1024 * 1024),
      )
    : null;
  const contents =
    region.tilesSizeBytes != null
      ? `Tiles ${toMb(region.tilesSizeBytes)} MB · Routing ${toMb(region.routingSizeBytes)} MB · Geocoding ${toMb(region.geocodingSizeBytes)} MB`
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
          <View style={styles.badges}>
            {updateAvailable && region.downloadStatus === 'complete' && (
              <View style={[styles.badge, styles.updateBadge]}>
                <Text style={[styles.badgeText, styles.updateText]}>Update</Text>
              </View>
            )}
            <StatusBadge status={region.downloadStatus} />
          </View>
        </View>

        {sizeMb != null && <Text style={styles.size}>{sizeMb} MB total</Text>}
        {contents != null && <Text style={styles.contents}>{contents}</Text>}
        {region.downloadStatus === 'complete' && (
          <Text style={styles.contents}>Stored offline · seeding to nearby peers via P2P</Text>
        )}
      </Pressable>

      <View style={styles.actions}>
        {region.downloadStatus === 'none' && (
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionPressed]}
            onPress={() => onDownload?.(region)}
          >
            <Text style={styles.actionText}>Download</Text>
          </Pressable>
        )}
        {region.downloadStatus === 'downloading' && (
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              styles.cancelBtn,
              pressed && styles.actionPressed,
            ]}
            onPress={() => onCancel?.(region)}
          >
            <Text style={[styles.actionText, styles.cancelText]}>Cancel</Text>
          </Pressable>
        )}
        {region.downloadStatus === 'failed' && (
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              styles.retryBtn,
              pressed && styles.actionPressed,
            ]}
            onPress={() => onDownload?.(region)}
          >
            <Text style={[styles.actionText, styles.retryText]}>Retry</Text>
          </Pressable>
        )}
        {region.downloadStatus === 'complete' && (
          <>
            {updateAvailable && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.updateBtn,
                  pressed && styles.actionPressed,
                ]}
                onPress={() => onDownload?.(region)}
              >
                <Text style={[styles.actionText, styles.updateActionText]}>Update</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.dangerBtn,
                pressed && styles.actionPressed,
              ]}
              onPress={() => onDelete?.(region)}
            >
              <Text style={[styles.actionText, styles.dangerText]}>Delete</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
});

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
  badges: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  size: { ...typography.caption, color: colors.textSecondary, marginBottom: 2 },
  contents: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    fontSize: 11,
  },
  badge: { borderRadius: borderRadius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { ...typography.caption, fontWeight: '600' },
  updateBadge: { backgroundColor: colors.warning + '20' },
  updateText: { color: colors.warning },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.sm },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionPressed: { opacity: 0.7 },
  actionText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  retryBtn: { borderColor: colors.warning },
  retryText: { color: colors.warning },
  updateBtn: { borderColor: colors.warning },
  updateActionText: { color: colors.warning },
  dangerBtn: { borderColor: colors.error },
  dangerText: { color: colors.error },
  cancelBtn: { borderColor: colors.textSecondary },
  cancelText: { color: colors.textSecondary },
});
