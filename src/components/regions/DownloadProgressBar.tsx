import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useThemedStyles, type Theme } from '../../hooks/useThemedStyles';
import type { DownloadProgress } from '../../services/regions/downloadService';

interface DownloadProgressBarProps {
  progress: DownloadProgress;
}

/**
 * Label for a progress stage.
 *
 * Stages without a meaningful percent — expanding the archive, importing
 * indexes — read as "stuck at 100%" when the last transfer's figure is kept, so
 * they render as an indeterminate bar instead (see `isFinishing`).
 */
export function downloadStageLabel(progress: DownloadProgress): string {
  switch (progress.stage) {
    case 'tiles':
      return 'Downloading map tiles…';
    case 'unpack':
      return 'Expanding map files…';
    case 'finalizing':
      return 'Finishing up…';
    case 'places':
      return 'Importing places…';
    case 'routing':
      return 'Downloading routing data…';
    case 'geocoding':
      return 'Downloading search index…';
    case 'indices':
      return 'Importing search index…';
    case 'complete':
      return 'Download complete';
    case 'error':
      return progress.error ? `Error: ${progress.error}` : 'Download failed';
  }
}

/**
 * True when the transfer is done but work continues (unpacking, importing,
 * seeding) and nothing reports progress. The bar pulses instead of sitting at a
 * frozen 100%, which read as a hang.
 */
export function isFinishing(progress: DownloadProgress): boolean {
  return (
    progress.stage !== 'complete' &&
    progress.stage !== 'error' &&
    (progress.stage === 'unpack' || progress.stage === 'finalizing' || progress.percent >= 100)
  );
}

export function DownloadProgressBar({ progress }: DownloadProgressBarProps) {
  const styles = useThemedStyles(createStyles);
  const pulse = useRef(new Animated.Value(1)).current;
  const finishing = isFinishing(progress);

  useEffect(() => {
    if (!finishing) {
      pulse.setValue(1);
      return;
    }
    // Indeterminate: the archive expansion can take minutes with no bytes
    // transferred, so animate presence rather than freeze at 100%.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [finishing, pulse]);

  const label = downloadStageLabel(progress);
  const indeterminate = finishing || progress.stage === 'error';

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {!indeterminate && <Text style={styles.percent}>{Math.round(progress.percent)}%</Text>}
      </View>
      <View style={styles.barBackground}>
        <Animated.View
          style={[
            styles.barFill,
            {
              width: `${Math.min(100, Math.max(4, progress.percent))}%`,
              opacity: pulse,
              backgroundColor: progress.stage === 'error' ? styles.errorColors.color : undefined,
            },
          ]}
        />
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    container: { marginVertical: spacing.sm },
    labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
    label: { ...typography.caption, color: colors.textSecondary, flex: 1 },
    percent: { ...typography.caption, color: colors.primary, fontWeight: '600' },
    barBackground: {
      height: 6,
      backgroundColor: colors.border,
      borderRadius: borderRadius.round,
      overflow: 'hidden',
    },
    barFill: { height: '100%', backgroundColor: colors.primary, borderRadius: borderRadius.round },
    errorColors: { color: colors.error },
  });
