import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettingsStore, type ThemeMode } from '../../stores/settingsStore';
import { useAtprotoAuthStore } from '../../stores/atprotoAuthStore';
import { syncResourceLimits } from '../../services/sync/peerService';
import { Button } from '../common';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

function SliderRow({
  label,
  value,
  unit,
  styles,
}: {
  label: string;
  value: number;
  unit: string;
  styles: ReturnType<typeof createStyles>;
}) {
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

interface SettingsContentProps {
  showHeading?: boolean;
}

export function SettingsContent({ showHeading = true }: SettingsContentProps) {
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
  const bskySession = useAtprotoAuthStore((s) => s.session);
  const bskyError = useAtprotoAuthStore((s) => s.error);
  const bskyIsLoading = useAtprotoAuthStore((s) => s.isLoading);
  const bskyLogin = useAtprotoAuthStore((s) => s.login);
  const bskyLogout = useAtprotoAuthStore((s) => s.logout);
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {showHeading && <Text style={styles.heading}>Settings</Text>}

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
          styles={styles}
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
          styles={styles}
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
          styles={styles}
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

        {bskySession ? (
          <View style={styles.bskySection}>
            <View style={styles.bskyLoggedInRow}>
              <MaterialCommunityIcons name="butterfly" size={20} color="#0085FF" />
              <View style={styles.flexOne}>
                <Text style={[styles.toggleLabel, styles.toggleLabelStrong]}>
                  @{bskySession.handle}
                </Text>
                <Text style={styles.bskyCaption}>{bskySession.did}</Text>
              </View>
            </View>
            <Text style={styles.bskyBody}>Your reviews are stored on your Bluesky PDS.</Text>
            <Button title="Disconnect" variant="ghost" onPress={bskyLogout} />
          </View>
        ) : (
          <View style={styles.bskySection}>
            <Text style={[styles.toggleLabel, styles.toggleLabelSemiBold]}>Connect Bluesky</Text>
            <Text style={styles.bskyBody}>
              Sign in to save reviews to your Bluesky account. Reviews are stored on your own PDS
              and remain yours. You can still leave anonymous reviews without connecting.
            </Text>
            <TextInput
              style={styles.bskyInput}
              value={bskyHandle}
              onChangeText={setBskyHandle}
              placeholder="you.bsky.social"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.bskyInput}
              value={bskyPassword}
              onChangeText={setBskyPassword}
              placeholder="App password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {bskyError ? <Text style={styles.bskyError}>{bskyError}</Text> : null}
            <Button
              title={bskyIsLoading ? 'Connecting…' : 'Connect Bluesky'}
              variant="primary"
              onPress={() => bskyLogin(bskyHandle.trim(), bskyPassword)}
              disabled={bskyIsLoading || !bskyHandle.trim() || !bskyPassword}
            />
          </View>
        )}

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
    toggleLabelStrong: { fontWeight: '700' },
    toggleLabelSemiBold: { fontWeight: '600' },
    bskySection: {
      marginBottom: spacing.lg,
      gap: spacing.sm,
    },
    bskyLoggedInRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    flexOne: {
      flex: 1,
    },
    bskyCaption: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    bskyBody: {
      ...typography.bodySmall,
      color: colors.textSecondary,
    },
    bskyInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      ...typography.body,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    bskyError: {
      ...typography.caption,
      color: colors.error,
    },
  });
