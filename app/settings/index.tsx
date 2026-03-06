import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { syncResourceLimits } from '../../src/services/sync/peerService';
import { ErrorBoundary } from '../../src/components/common';
import { colors, spacing, typography } from '../../src/constants/theme';

function SliderRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <Text style={styles.sliderValue}>
        {value} {unit}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { resourceLimits, permissions, setResourceLimits, setPermissions } = useSettingsStore();

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
          <Text style={styles.sectionTitle}>Resource Limits</Text>

          <SliderRow label="Max Storage" value={resourceLimits.maxStorageMb} unit="MB" />
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

          <SliderRow label="Max Bandwidth" value={resourceLimits.maxBandwidthMbps} unit="Mbps" />
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

          <SliderRow label="Max Battery" value={resourceLimits.maxBatteryPctHr} unit="% / hr" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  heading: { ...typography.h1, color: colors.text, marginBottom: spacing.lg },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.md },
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
