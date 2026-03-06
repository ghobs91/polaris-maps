import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../constants/theme';
import type { DownloadProgress } from '../../services/regions/downloadService';

interface DownloadProgressBarProps {
  progress: DownloadProgress;
}

export function DownloadProgressBar({ progress }: DownloadProgressBarProps) {
  const stageLabel =
    progress.stage === 'tiles'
      ? 'Downloading map tiles…'
      : progress.stage === 'routing'
        ? 'Downloading routing data…'
        : progress.stage === 'geocoding'
          ? 'Downloading search index…'
          : progress.stage === 'complete'
            ? 'Download complete'
            : progress.stage === 'error'
              ? `Error: ${progress.error}`
              : 'Preparing…';

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{stageLabel}</Text>
        <Text style={styles.percent}>{Math.round(progress.percent)}%</Text>
      </View>
      <View style={styles.barBackground}>
        <View style={[styles.barFill, { width: `${Math.min(100, progress.percent)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary },
  percent: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  barBackground: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: borderRadius.round,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.primary, borderRadius: borderRadius.round },
});
