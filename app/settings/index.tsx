import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { useSettingsStore, type ThemeMode } from '../../src/stores/settingsStore';
import { syncResourceLimits } from '../../src/services/sync/peerService';
import { ErrorBoundary } from '../../src/components/common';
import { spacing, typography } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';

function SliderRow({
  label,
  value,
  unit,
  colors,
}: {
  label: string;
  value: number;
  unit: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <Text style={styles.sliderValue}>
        {value} {unit}
      </Text>
    </View>
  );
}

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export default function SettingsScreen() {
  const {
    resourceLimits,
    permissions,
    themeMode,
    setResourceLimits,
    setPermissions,
    setThemeMode,
  } = useSettingsStore();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleStorageChange = useCallback(
    (value: number) => {
      setResourceLimits({ maxStorageMb: Math.round(value) });
      syncResourceLimits().catch(() => {});
    },
    [setResourceLimits],
  );

  const handleBandwidthChange = useCallback(
    (value: number) => {
      setResourceLimits({ maxBandwidthMbps: Math.round(value * 10) / 10 });
      syncResourceLimits().catch(() => {});
    },
    [setResourceLimits],
  );

  const handleBatteryChange = useCallback(
    (value: number) => {
      setResourceLimits({ maxBatteryPctHr: Math.round(value) });
      syncResourceLimits().catch(() => {});
    },
    [setResourceLimits],
  );

  return (
    <ErrorBoundary>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.themeChip, themeMode === opt.value && styles.themeChipActive]}
                onPress={() => setThemeMode(opt.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.themeChipText,
                    themeMode === opt.value && styles.themeChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resource Limits</Text>

          <SliderRow
            label="Max Storage"
            value={resourceLimits.maxStorageMb}
            unit="MB"
            colors={colors}
          />
          <View style={styles.buttonRow}>
            {[512, 1024, 2048, 4096].map((mb) => (
              <Text
                key={mb}
                style={[styles.chip, resourceLimits.maxStorageMb === mb && styles.chipActive]}
                onPress={() => handleStorageChange(mb)}
              >
                {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
              </Text>
            ))}
          </View>

          <SliderRow
            label="Max Bandwidth"
            value={resourceLimits.maxBandwidthMbps}
            unit="Mbps"
            colors={colors}
          />
          <View style={styles.buttonRow}>
            {[1, 5, 10, 25].map((mbps) => (
              <Text
                key={mbps}
                style={[styles.chip, resourceLimits.maxBandwidthMbps === mbps && styles.chipActive]}
                onPress={() => handleBandwidthChange(mbps)}
              >
                {mbps} Mbps
              </Text>
            ))}
          </View>

          <SliderRow
            label="Max Battery"
            value={resourceLimits.maxBatteryPctHr}
            unit="% / hr"
            colors={colors}
          />
          <View style={styles.buttonRow}>
            {[2, 5, 10, 15].map((pct) => (
              <Text
                key={pct}
                style={[styles.chip, resourceLimits.maxBatteryPctHr === pct && styles.chipActive]}
                onPress={() => handleBatteryChange(pct)}
              >
                {pct}%
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Location Access</Text>
            <Switch
              value={permissions.locationEnabled}
              onValueChange={(v) => setPermissions({ locationEnabled: v })}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Traffic Telemetry</Text>
            <Switch
              value={permissions.trafficTelemetryEnabled}
              onValueChange={(v) => setPermissions({ trafficTelemetryEnabled: v })}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>POI Contributions</Text>
            <Switch
              value={permissions.poiContributionsEnabled}
              onValueChange={(v) => setPermissions({ poiContributionsEnabled: v })}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Imagery Sharing</Text>
            <Switch
              value={permissions.imagerySharingEnabled}
              onValueChange={(v) => setPermissions({ imagerySharingEnabled: v })}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </View>
      </ScrollView>
    </ErrorBoundary>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },
    heading: { ...typography.h1, color: colors.text, marginBottom: spacing.lg },
    section: { marginBottom: spacing.xl },
    sectionTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.md },
    themeRow: { flexDirection: 'row', gap: spacing.sm },
    themeChip: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    themeChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '1A',
    },
    themeChipText: { ...typography.label, color: colors.textSecondary },
    themeChipTextActive: { color: colors.primary, fontWeight: '700' },
    sliderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sliderLabel: { ...typography.body, color: colors.text },
    sliderValue: { ...typography.body, color: colors.primary, fontWeight: '600' },
    buttonRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.lg,
      marginTop: spacing.xs,
    },
    chip: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      overflow: 'hidden',
    },
    chipActive: {
      color: colors.primary,
      borderColor: colors.primary,
      fontWeight: '600',
    },
    toggleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    toggleLabel: { ...typography.body, color: colors.text },
  });
