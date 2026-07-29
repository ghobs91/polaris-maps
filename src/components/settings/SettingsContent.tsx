import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  TextInput,
  Linking,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettingsStore, type ThemeMode } from '../../stores/settingsStore';
import { useAtprotoAuthStore } from '../../stores/atprotoAuthStore';
import { useOsmAuthStore } from '../../stores/osmAuthStore';
import { Button, GlassView } from '../common';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

interface SettingsContentProps {
  showHeading?: boolean;
}

export function SettingsContent({ showHeading = true }: SettingsContentProps) {
  const permissions = useSettingsStore((s) => s.permissions);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const voiceGuidanceEnabled = useSettingsStore((s) => s.voiceGuidanceEnabled);
  const routePreferences = useSettingsStore((s) => s.routePreferences);
  const setPermissions = useSettingsStore((s) => s.setPermissions);
  const setRoutePreferences = useSettingsStore((s) => s.setRoutePreferences);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const setVoiceGuidanceEnabled = useSettingsStore((s) => s.setVoiceGuidanceEnabled);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bskySession = useAtprotoAuthStore((s) => s.session);
  const bskyError = useAtprotoAuthStore((s) => s.error);
  const bskyIsLoading = useAtprotoAuthStore((s) => s.isLoading);
  const bskyLogin = useAtprotoAuthStore((s) => s.login);
  const bskyLogout = useAtprotoAuthStore((s) => s.logout);
  const osmUser = useOsmAuthStore((s) => s.user);
  const osmAccessToken = useOsmAuthStore((s) => s.accessToken);
  const osmIsLoggingIn = useOsmAuthStore((s) => s.isLoggingIn);
  const osmLogin = useOsmAuthStore((s) => s.login);
  const osmLogout = useOsmAuthStore((s) => s.logout);
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPassword, setBskyPassword] = useState('');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {showHeading && <Text style={styles.heading}>Settings</Text>}

      <GlassView material="regular" style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.themeChip, themeMode === opt.value && styles.themeChipActive]}
              onPress={() => setThemeMode(opt.value)}
              activeOpacity={0.7}
              accessibilityLabel={`${opt.label} theme`}
              accessibilityRole="radio"
              accessibilityState={{ selected: themeMode === opt.value }}
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
      </GlassView>

      <GlassView material="regular" style={styles.section}>
        <Text style={styles.sectionTitle}>Navigation</Text>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Voice Guidance</Text>
          <Switch
            value={voiceGuidanceEnabled}
            onValueChange={setVoiceGuidanceEnabled}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Voice Guidance"
            accessibilityHint="Speak turn-by-turn directions during navigation"
          />
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Avoid Tolls</Text>
          <Switch
            value={routePreferences.avoidTolls}
            onValueChange={(v) => setRoutePreferences({ avoidTolls: v })}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Avoid Tolls"
            accessibilityHint="Prefer routes that avoid toll roads"
          />
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Avoid Highways</Text>
          <Switch
            value={routePreferences.avoidHighways}
            onValueChange={(v) => setRoutePreferences({ avoidHighways: v })}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Avoid Highways"
            accessibilityHint="Prefer routes that avoid highways"
          />
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Avoid Ferries</Text>
          <Switch
            value={routePreferences.avoidFerries}
            onValueChange={(v) => setRoutePreferences({ avoidFerries: v })}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Avoid Ferries"
            accessibilityHint="Prefer routes that avoid ferry crossings"
          />
        </View>
      </GlassView>

      <GlassView material="regular" style={styles.section}>
        <Text style={styles.sectionTitle}>Accounts</Text>

        <GlassView material="clear" style={styles.accountCard}>
          <Text style={[styles.toggleLabel, styles.toggleLabelSemiBold]}>OpenStreetMap</Text>
          {osmAccessToken && osmUser ? (
            <View style={styles.accountDetails}>
              <View style={styles.accountHeaderRow}>
                <MaterialCommunityIcons name="map" size={20} color="#7EBC6F" />
                <View style={styles.flexOne}>
                  <Text style={[styles.toggleLabel, styles.toggleLabelStrong]}>
                    {osmUser.displayName}
                  </Text>
                  <Text style={styles.accountCaption}>Signed in to OpenStreetMap</Text>
                </View>
              </View>
              <Text style={styles.accountBody}>
                You can add and update places on OpenStreetMap. Your contributions are public.
              </Text>
              <View style={styles.osmStatsRow}>
                <MaterialCommunityIcons
                  name="star-outline"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text style={styles.accountBody}>
                  {osmUser.changesetCount} changesets on OpenStreetMap
                </Text>
              </View>
              <Button
                title="View Latest Contributions"
                variant="ghost"
                onPress={() => {
                  Linking.openURL(
                    `https://www.openstreetmap.org/user/${encodeURIComponent(osmUser.displayName)}/history`,
                  );
                }}
              />
              <Button title="Sign Out" variant="ghost" onPress={osmLogout} />
            </View>
          ) : (
            <View style={styles.accountDetails}>
              <Text style={styles.accountBody}>
                Connect your OpenStreetMap account to add places to OSM directly from the map.
              </Text>
              <Button
                title={osmIsLoggingIn ? 'Signing in…' : 'Sign in with OpenStreetMap'}
                variant="primary"
                onPress={() => osmLogin().catch(() => {})}
                disabled={osmIsLoggingIn}
              />
            </View>
          )}
        </GlassView>

        <GlassView material="clear" style={styles.accountCard}>
          <Text style={[styles.toggleLabel, styles.toggleLabelSemiBold]}>Bluesky</Text>
          {bskySession ? (
            <View style={styles.accountDetails}>
              <View style={styles.accountHeaderRow}>
                <MaterialCommunityIcons name="butterfly" size={20} color="#0085FF" />
                <View style={styles.flexOne}>
                  <Text style={[styles.toggleLabel, styles.toggleLabelStrong]}>
                    @{bskySession.handle}
                  </Text>
                  <Text style={styles.accountCaption}>{bskySession.did}</Text>
                </View>
              </View>
              <Text style={styles.accountBody}>Your reviews are stored on your Bluesky PDS.</Text>
              <Button title="Disconnect" variant="ghost" onPress={bskyLogout} />
            </View>
          ) : (
            <View style={styles.accountDetails}>
              <Text style={styles.accountBody}>
                Sign in to save reviews to your Bluesky account. Reviews are stored on your own PDS
                and remain yours. You can still leave anonymous reviews without connecting.
              </Text>
              <TextInput
                style={styles.accountInput}
                value={bskyHandle}
                onChangeText={setBskyHandle}
                placeholder="you.bsky.social"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.accountInput}
                value={bskyPassword}
                onChangeText={setBskyPassword}
                placeholder="App password"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              {bskyError ? <Text style={styles.accountError}>{bskyError}</Text> : null}
              <Button
                title={bskyIsLoading ? 'Connecting…' : 'Connect Bluesky'}
                variant="primary"
                onPress={() => bskyLogin(bskyHandle.trim(), bskyPassword)}
                disabled={bskyIsLoading || !bskyHandle.trim() || !bskyPassword}
              />
            </View>
          )}
        </GlassView>
      </GlassView>

      <GlassView material="regular" style={styles.section}>
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
      </GlassView>

      <GlassView material="regular" style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://polarismaps.com/privacy')}
          activeOpacity={0.6}
          accessibilityLabel="Privacy Policy"
          accessibilityHint="Opens the Polaris Maps privacy policy in your browser"
          accessibilityRole="link"
        >
          <Text style={[styles.linkLabel, { color: colors.text }]}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://polarismaps.com/terms')}
          activeOpacity={0.6}
          accessibilityLabel="Terms of Service"
          accessibilityHint="Opens the Polaris Maps terms of service in your browser"
          accessibilityRole="link"
        >
          <Text style={[styles.linkLabel, { color: colors.text }]}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </GlassView>
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },
    heading: { ...typography.h1, color: colors.text, marginBottom: spacing.lg },
    section: {
      marginBottom: spacing.xl,
      padding: spacing.md,
      borderRadius: borderRadius.xl,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    sectionTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.md },
    themeRow: { flexDirection: 'row', gap: spacing.sm },
    themeChip: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      borderRadius: 999,
      borderCurve: 'continuous',
      backgroundColor: colors.glass.background,
    },
    themeChipActive: {
      backgroundColor: colors.primary + '24',
    },
    themeChipText: { ...typography.label, color: colors.textSecondary },
    themeChipTextActive: { color: colors.primary, fontWeight: '700' },
    toggleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    toggleLabel: { ...typography.body, color: colors.text },
    toggleLabelStrong: { fontWeight: '700' },
    toggleLabelSemiBold: { fontWeight: '600' },
    accountCard: {
      marginBottom: spacing.lg,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
      gap: spacing.xs,
    },
    accountDetails: {
      gap: spacing.sm,
    },
    accountHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    flexOne: {
      flex: 1,
    },
    accountCaption: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    accountBody: {
      ...typography.bodySmall,
      color: colors.textSecondary,
    },
    accountInput: {
      borderRadius: borderRadius.md,
      borderCurve: 'continuous',
      padding: spacing.sm,
      ...typography.body,
      color: colors.text,
      backgroundColor: colors.glass.background,
    },
    accountError: {
      ...typography.caption,
      color: colors.error,
    },
    osmStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    linkRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    linkLabel: {
      ...typography.body,
    },
  });
