import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SegmentedControl, SettingsGroup, SettingsRow } from '../common';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useDashCamStore } from '../../stores/dashCamStore';
import { stopDashCam } from '../../services/dashcam/dashCamSession';
import {
  getDashCamTotals,
  pruneDashCamClips,
  reconcileDashCamClips,
} from '../../services/dashcam/dashCamQueue';
import type { DashCamTotals } from '../../models/dashCam';
import { formatBytes } from '../../utils/formatBytes';

const CLIP_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
];

const KEEP_OPTIONS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
];

const GIGABYTE = 1024 * 1024 * 1024;
const SIZE_OPTIONS = [
  { label: '1 GB', value: GIGABYTE },
  { label: '2 GB', value: 2 * GIGABYTE },
  { label: '4 GB', value: 4 * GIGABYTE },
  { label: '8 GB', value: 8 * GIGABYTE },
];

export function DashCamSettings() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const dashCam = useSettingsStore((s) => s.dashCam);
  const setDashCam = useSettingsStore((s) => s.setDashCam);
  const recording = useDashCamStore((s) => s.recording);
  const [totals, setTotals] = useState<DashCamTotals>({ clips: 0, bytes: 0, durationMs: 0 });

  const refresh = React.useCallback(() => {
    void reconcileDashCamClips()
      .catch(() => 0)
      .then(() => getDashCamTotals())
      .then(setTotals)
      .catch(() => setTotals({ clips: 0, bytes: 0, durationMs: 0 }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, recording]);

  const toggleEnabled = (enabled: boolean) => {
    setDashCam({ enabled });
    if (!enabled && recording) stopDashCam();
  };

  /** Changing a cap should take effect immediately, not on the next clip. */
  const applyRetention = (patch: { maxMinutes?: number; maxBytes?: number }) => {
    setDashCam(patch);
    const next = { maxMinutes: dashCam.maxMinutes, maxBytes: dashCam.maxBytes, ...patch };
    void pruneDashCamClips(next)
      .then(refresh)
      .catch((error) =>
        Alert.alert(
          'Could not trim footage',
          error instanceof Error ? error.message : String(error),
        ),
      );
  };

  const keptMinutes = Math.round(totals.durationMs / 60_000);

  return (
    <SettingsGroup
      header="Dash cam"
      footer="Records muted video in segments while you drive and keeps only the most recent footage: once either the time or the storage limit is reached, the oldest clips are deleted automatically. Recording stops when the app is backgrounded or the phone is locked. Street-imagery photos can be captured at the same time as the dash cam."
    >
      <SettingsRow
        title="Dash cam"
        rightAdornment={
          <Switch
            value={dashCam.enabled}
            onValueChange={toggleEnabled}
            trackColor={{
              false: isDark ? '#39393D' : '#E5E5EA',
              true: colors.primary + 'CC',
            }}
          />
        }
      />
      <SettingsRow
        title="Clip length"
        rightAdornment={
          <View style={styles.segment}>
            <SegmentedControl
              options={CLIP_OPTIONS}
              value={dashCam.clipSeconds}
              onChange={(clipSeconds) => setDashCam({ clipSeconds })}
              label="Dash cam clip length"
            />
          </View>
        }
      />
      <SettingsRow
        title="Keep footage"
        value={`${keptMinutes} of ${dashCam.maxMinutes} min`}
        rightAdornment={
          <View style={styles.segment}>
            <SegmentedControl
              options={KEEP_OPTIONS}
              value={dashCam.maxMinutes}
              onChange={(maxMinutes) => applyRetention({ maxMinutes })}
              label="Dash cam retention time"
            />
          </View>
        }
      />
      <SettingsRow
        title="Storage limit"
        rightAdornment={
          <View style={styles.segment}>
            <SegmentedControl
              options={SIZE_OPTIONS}
              value={dashCam.maxBytes}
              onChange={(maxBytes) => applyRetention({ maxBytes })}
              label="Dash cam storage limit"
            />
          </View>
        }
      />
      <SettingsRow
        title="Recordings"
        value={
          totals.clips > 0
            ? `${totals.clips} clip${totals.clips === 1 ? '' : 's'} · ${formatBytes(totals.bytes)}`
            : 'None'
        }
        onPress={() => router.push('/dashcam')}
      />
      {recording ? (
        <Text style={styles.recordingHint}>Recording now — stop from the map.</Text>
      ) : null}
    </SettingsGroup>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    segment: { maxWidth: 220 },
    recordingHint: {
      ...typography.caption,
      color: colors.textSecondary,
      fontSize: 12,
      paddingTop: spacing.xs,
    },
  });
