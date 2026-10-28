import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SettingsChoiceRow, SettingsGroup, SettingsRow } from '../common';
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

/** Rolling dash-cam buffer: recording, segment length, and both retention caps. */
export function DashCamSettings() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const dashCam = useSettingsStore((s) => s.dashCam);
  const setDashCam = useSettingsStore((s) => s.setDashCam);
  const recording = useDashCamStore((s) => s.recording);
  const [totals, setTotals] = useState<DashCamTotals>({ clips: 0, bytes: 0, durationMs: 0 });

  const refresh = useCallback(() => {
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

  /** Changing a cap takes effect immediately, not on the next clip. */
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
  const trackColor = {
    false: isDark ? '#39393D' : '#E5E5EA',
    true: colors.primary + 'CC',
  };

  return (
    <SettingsGroup
      header="Dash cam"
      icon={<Ionicons name="videocam-outline" size={15} color={colors.textSecondary} />}
      footer="Muted rolling video. The oldest clips are deleted when either limit is reached."
    >
      <SettingsRow
        title="Dash cam"
        rightAdornment={
          <Switch value={dashCam.enabled} onValueChange={toggleEnabled} trackColor={trackColor} />
        }
      />
      <SettingsRow
        title="Start on every drive"
        rightAdornment={
          <Switch
            value={dashCam.autoStart}
            disabled={!dashCam.enabled}
            onValueChange={(autoStart) => setDashCam({ autoStart })}
            trackColor={trackColor}
          />
        }
      />
      <SettingsChoiceRow
        title="Clip length"
        options={CLIP_OPTIONS}
        value={dashCam.clipSeconds}
        onChange={(clipSeconds) => setDashCam({ clipSeconds })}
      />
      <SettingsChoiceRow
        title="Keep footage"
        detail={`${keptMinutes} of ${dashCam.maxMinutes} min`}
        options={KEEP_OPTIONS}
        value={dashCam.maxMinutes}
        onChange={(maxMinutes) => applyRetention({ maxMinutes })}
      />
      <SettingsChoiceRow
        title="Storage limit"
        detail={`${formatBytes(totals.bytes)} used`}
        options={SIZE_OPTIONS}
        value={dashCam.maxBytes}
        onChange={(maxBytes) => applyRetention({ maxBytes })}
      />
      <SettingsRow
        title="Recordings"
        value={totals.clips > 0 ? `${totals.clips} clip${totals.clips === 1 ? '' : 's'}` : 'None'}
        onPress={() => router.push('/dashcam')}
      />
      {recording ? (
        <Text style={[styles.recordingHint, { color: colors.textSecondary }]}>
          Recording now — stop from the map.
        </Text>
      ) : null}
    </SettingsGroup>
  );
}

const styles = StyleSheet.create({
  recordingHint: {
    ...typography.caption,
    fontSize: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
