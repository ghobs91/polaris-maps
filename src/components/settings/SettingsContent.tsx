import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Linking } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettingsStore, type ThemeMode } from '../../stores/settingsStore';
import { useAtprotoAuthStore } from '../../stores/atprotoAuthStore';
import { useOsmAuthStore } from '../../stores/osmAuthStore';
import { Button, SettingsGroup, SettingsRow, SFSymbol } from '../common';
import { spacing, typography, iosListGroup } from '../../constants/theme';
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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(isDark), [isDark]);
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
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {showHeading && <Text style={styles.heading}>Settings</Text>}

      <SettingsGroup header="Appearance" footer="Choose how Polaris Maps looks on this device.">
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt, idx) => {
            const active = themeMode === opt.value;
            return (
              <React.Fragment key={opt.value}>
                <View style={styles.themeCell}>
                  <Text
                    style={[styles.themeCellText, active ? styles.themeCellTextActive : null]}
                    onPress={() => setThemeMode(opt.value)}
                    suppressHighlighting={false}
                  >
                    {opt.label}
                  </Text>
                </View>
                {idx < THEME_OPTIONS.length - 1 ? <View style={styles.themeSeparator} /> : null}
              </React.Fragment>
            );
          })}
        </View>
      </SettingsGroup>

      <SettingsGroup header="Navigation">
        <SettingsRow
          title="Voice Guidance"
          rightAdornment={
            <Switch
              value={voiceGuidanceEnabled}
              onValueChange={setVoiceGuidanceEnabled}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
        <SettingsRow
          title="Avoid Tolls"
          rightAdornment={
            <Switch
              value={routePreferences.avoidTolls}
              onValueChange={(v) => setRoutePreferences({ avoidTolls: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
        <SettingsRow
          title="Avoid Highways"
          rightAdornment={
            <Switch
              value={routePreferences.avoidHighways}
              onValueChange={(v) => setRoutePreferences({ avoidHighways: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
        <SettingsRow
          title="Avoid Ferries"
          rightAdornment={
            <Switch
              value={routePreferences.avoidFerries}
              onValueChange={(v) => setRoutePreferences({ avoidFerries: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        header="Accounts"
        footer="Sign in with OpenStreetMap to edit places and with Bluesky to leave reviews."
      >
        <View style={styles.accountCard}>
          {osmAccessToken && osmUser ? (
            <>
              <View style={styles.accountRow}>
                <View style={[styles.accountIcon, { backgroundColor: '#7EBC6F' }]}>
                  <MaterialCommunityIcons name="map" size={16} color="#FFFFFF" />
                </View>
                <View style={styles.accountTextCol}>
                  <Text style={styles.accountName} numberOfLines={1}>
                    {osmUser.displayName}
                  </Text>
                  <Text style={styles.accountCaption} numberOfLines={1}>
                    OpenStreetMap
                  </Text>
                </View>
              </View>
              <SettingsRow
                title="View Latest Contributions"
                onPress={() => {
                  Linking.openURL(
                    `https://www.openstreetmap.org/user/${encodeURIComponent(osmUser.displayName)}/history`,
                  );
                }}
              />
              <SettingsRow title="Sign Out" onPress={osmLogout} />
            </>
          ) : (
            <View style={styles.accountSigninRow}>
              <Button
                title={osmIsLoggingIn ? 'Signing in…' : 'Sign in with OpenStreetMap'}
                variant="primary"
                onPress={() => osmLogin().catch(() => {})}
                disabled={osmIsLoggingIn}
                style={styles.signinBtn}
              />
            </View>
          )}
        </View>

        <View style={styles.accountCard}>
          {bskySession ? (
            <>
              <View style={styles.accountRow}>
                <View style={[styles.accountIcon, { backgroundColor: '#0085FF' }]}>
                  <MaterialCommunityIcons name="butterfly" size={16} color="#FFFFFF" />
                </View>
                <View style={styles.accountTextCol}>
                  <Text style={styles.accountName} numberOfLines={1}>
                    @{bskySession.handle}
                  </Text>
                  <Text style={styles.accountCaption} numberOfLines={1}>
                    Signed in for reviews
                  </Text>
                </View>
              </View>
              <SettingsRow title="Disconnect" onPress={bskyLogout} destructive />
            </>
          ) : (
            <View style={styles.bskySigninBlock}>
              <View style={styles.accountRow}>
                <View style={[styles.accountIcon, { backgroundColor: '#0085FF' }]}>
                  <MaterialCommunityIcons name="butterfly" size={16} color="#FFFFFF" />
                </View>
                <View style={styles.accountTextCol}>
                  <Text style={styles.accountName}>Bluesky</Text>
                  <Text style={styles.accountCaption}>Leave reviews on places</Text>
                </View>
              </View>
              {bskyError ? <Text style={styles.errorText}>{bskyError}</Text> : null}
              <Button
                title={bskyIsLoading ? 'Signing in…' : 'Sign in to leave reviews'}
                variant="primary"
                onPress={() => bskyLogin('bsky.social')}
                disabled={bskyIsLoading}
                style={styles.signinBtn}
              />
            </View>
          )}
        </View>
      </SettingsGroup>

      <SettingsGroup
        header="Privacy"
        footer="Telemetry shares anonymous speed probes on geohash channels to build live traffic with nearby peers. Contributions pause offline and queue (max 500) for replay."
      >
        <SettingsRow
          title="Location Access"
          rightAdornment={
            <Switch
              value={permissions.locationEnabled}
              onValueChange={(v) => setPermissions({ locationEnabled: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
        <SettingsRow
          title="Traffic Telemetry"
          rightAdornment={
            <Switch
              value={permissions.trafficTelemetryEnabled}
              onValueChange={(v) => setPermissions({ trafficTelemetryEnabled: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
        <SettingsRow
          title="POI Contributions"
          rightAdornment={
            <Switch
              value={permissions.poiContributionsEnabled}
              onValueChange={(v) => setPermissions({ poiContributionsEnabled: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
        <SettingsRow
          title="Imagery Sharing"
          rightAdornment={
            <Switch
              value={permissions.imagerySharingEnabled}
              onValueChange={(v) => setPermissions({ imagerySharingEnabled: v })}
              trackColor={{ false: isDark ? '#39393D' : '#E5E5EA', true: colors.primary + 'CC' }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        header="CarPlay"
        footer="Navigation state, maneuvers, and search forward to CarPlay automatically when connected. No setup needed."
      >
        <SettingsRow title="CarPlay Mirroring" value="Automatic when connected" />
      </SettingsGroup>

      <SettingsGroup header="About">
        <SettingsRow
          title="Privacy Policy"
          rightAdornment={
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          }
          onPress={() => Linking.openURL('https://polarismaps.com/privacy')}
        />
        <SettingsRow
          title="Terms of Service"
          rightAdornment={
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          }
          onPress={() => Linking.openURL('https://polarismaps.com/terms')}
        />
      </SettingsGroup>
    </ScrollView>
  );
}

const createStyles = (isDark: boolean) => {
  const pageBg = isDark ? iosListGroup.pageBackground : '#F2F2F7';
  const headingColor = isDark ? '#FFFFFF' : '#000000';
  const captionColor = isDark ? '#8E8E93' : '#6C6C70';
  const primaryTextColor = isDark ? '#FFFFFF' : '#000000';
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: pageBg },
    content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    heading: {
      ...typography.largeTitle,
      color: headingColor,
      marginBottom: spacing.lg,
      marginLeft: spacing.sm,
    },
    themeRow: {
      flexDirection: 'row',
      minHeight: 44,
    },
    themeCell: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm + 2,
    },
    themeSeparator: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: isDark ? 'rgba(84,84,88,0.34)' : 'rgba(60,60,67,0.18)',
    },
    themeCellText: { ...typography.body, fontSize: 17, color: captionColor },
    themeCellTextActive: { color: isDark ? '#0A84FF' : '#007AFF', fontWeight: '600' },
    accountCard: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    accountIcon: {
      width: 28,
      height: 28,
      borderRadius: 6,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountTextCol: { flex: 1 },
    accountName: { ...typography.body, fontSize: 16, fontWeight: '500', color: primaryTextColor },
    accountCaption: { ...typography.caption, fontSize: 12, color: captionColor, marginTop: 1 },
    accountSigninRow: { paddingVertical: spacing.sm },
    signinBtn: { alignSelf: 'stretch' },
    bskySigninBlock: { paddingVertical: spacing.sm, gap: spacing.sm },
    errorText: { ...typography.caption, color: '#FF453A' },
  });
};

// Re-export SFSymbol so consumers don't have to import it separately.
export { SFSymbol };
