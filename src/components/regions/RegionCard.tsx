import React, { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles, type Theme } from '../../hooks/useThemedStyles';
import {
  packFeatureLabels,
  packSizeBytes,
  packScopeLabel,
  packScopeDescription,
} from '../../services/regions/packSummary';
import type { PackSourceChoice } from '../../stores/settingsStore';
import type { Region } from '../../models/region';

interface RegionCardProps {
  region: Region;
  onPress?: (region: Region) => void;
  onDownload?: (region: Region) => void;
  onCancel?: (region: Region) => void;
  onDelete?: (region: Region) => void;
  /** Whether a newer tile version is available from OpenFreeMap. */
  updateAvailable?: boolean;
  /**
   * Developer-only origin pin for this pack. Pass `onChangeSource` (and a value)
   * to render the picker; omit both for the normal release card.
   */
  sourceChoice?: PackSourceChoice;
  onChangeSource?: (choice: PackSourceChoice) => void;
  /**
   * Who has announced that they seed this pack, when P2P is selected.
   *
   * A "searching…" spinner with no other information is indistinguishable from a
   * hang, so the card says what the mesh already told us before the search starts.
   */
  relayHint?: string;
}

const SOURCE_LABELS: Record<PackSourceChoice, string> = {
  auto: 'Auto',
  primary: 'GitHub',
  mirror: 'Archive',
  p2p: 'P2P',
};

const SOURCE_CHOICES = ['auto', 'primary', 'mirror', 'p2p'] as const;

export const RegionCard = memo(function RegionCard({
  region,
  onPress,
  onDownload,
  onCancel,
  onDelete,
  updateAvailable,
  sourceChoice,
  onChangeSource,
  relayHint,
}: RegionCardProps) {
  const styles = useThemedStyles(createStyles);
  const toMb = (b?: number | null) =>
    ((b ?? 0) / (1024 * 1024)).toFixed(b && b >= 10 * 1024 * 1024 ? 0 : 1);

  // Shared with the "Downloaded" shelf so the two never disagree about a pack:
  // the manifest size is what actually downloads, and the legacy per-part
  // columns are coarse catalog estimates of which a row may carry only one
  // (New York Metro's row has just its geocoding estimate, which advertised a
  // 93 MB pack as 185 MB).
  const sizeMb = Math.round(packSizeBytes(region) / (1024 * 1024)) || null;
  const assetLabels = packFeatureLabels(region);
  const scopeLabel = packScopeLabel(region);

  const contents =
    assetLabels.length > 0
      ? assetLabels.join(' · ')
      : region.tilesSizeBytes != null
        ? `Tiles ${toMb(region.tilesSizeBytes)} MB · Routing ${toMb(region.routingSizeBytes)} MB · Geocoding ${toMb(region.geocodingSizeBytes)} MB` +
          (region.placesSizeBytes != null ? ` · Places ${toMb(region.placesSizeBytes)} MB` : '')
        : null;

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardBody, pressed && onPress && styles.pressed]}
        onPress={() => onPress?.(region)}
        accessibilityRole={onPress ? 'button' : 'none'}
        accessibilityLabel={`${region.name}, ${packScopeDescription(region)}`}
      >
        <View style={styles.header}>
          <Text style={styles.name}>{region.name}</Text>
          <View style={styles.badges}>
            {/* Tells "New York" (state) from "New York Metro" (city) when the
                search lists both. */}
            <View style={styles.scopeBadge}>
              <Text style={styles.scopeText}>{scopeLabel}</Text>
            </View>
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

      {/*
        Developer-only origin pin. Both origins are supposed to serve identical
        bytes, and the only way to confirm that is to fetch a pack from each on
        its own. Only shown before a download starts, because the choice is read
        when the transfer begins — changing it mid-download would do nothing and
        look broken.
      */}
      {onChangeSource &&
        (region.downloadStatus === 'none' || region.downloadStatus === 'failed') && (
          <View>
            <View style={styles.sourceRow}>
              <Text style={styles.sourceLabel}>Source</Text>
              {SOURCE_CHOICES.map((choice) => {
                const active = (sourceChoice ?? 'auto') === choice;
                return (
                  <Pressable
                    key={choice}
                    onPress={() => onChangeSource(choice)}
                    style={({ pressed }) => [
                      styles.sourceBtn,
                      active && styles.sourceBtnActive,
                      pressed && styles.actionPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Download from ${SOURCE_LABELS[choice]}`}
                  >
                    <Text style={[styles.sourceText, active && styles.sourceTextActive]}>
                      {SOURCE_LABELS[choice]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {sourceChoice === 'mirror' && (
              <Text style={styles.sourceHint}>
                Tries the Internet Archive first, then GitHub if this pack is not mirrored yet.
              </Text>
            )}
            {sourceChoice === 'p2p' && (
              <Text style={styles.sourceHint}>
                {relayHint ?? 'Searches the mesh for a peer or relay seeding this pack.'} No
                fallback to GitHub or Archive — if nothing is seeding, it fails visibly.
              </Text>
            )}
          </View>
        )}
    </View>
  );
});

function StatusBadge({ status }: { status: Region['downloadStatus'] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
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

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
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
    scopeBadge: {
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: colors.border,
    },
    scopeText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
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
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    sourceLabel: { ...typography.caption, color: colors.textSecondary, marginRight: 2 },
    sourceBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    sourceBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '15' },
    sourceText: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
    sourceTextActive: { color: colors.primary, fontWeight: '600' },
    sourceHint: {
      ...typography.caption,
      fontSize: 11,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
  });
