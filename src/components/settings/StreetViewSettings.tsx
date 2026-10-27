import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { SegmentedControl, SettingsGroup, SettingsRow } from '../common';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { confirmStreetViewConsent } from '../../services/imagery/streetViewConsent';
import { endStreetViewSession } from '../../services/imagery/streetViewSession';
import { connectMapillary, disconnectMapillary } from '../../services/imagery/mapillaryService';
import { isMapillaryUploadConfigured } from '../../constants/config';
import { getPendingTotals, listPendingDrives } from '../../services/imagery/streetViewQueue';
import { formatBytes } from '../../utils/formatBytes';

const MODE_OPTIONS = [
  { label: 'Standard', value: 'standard' as const },
  { label: '3D', value: 'threeD' as const },
];

export function StreetViewSettings() {
  const { colors, isDark } = useTheme();
  const streetView = useSettingsStore((s) => s.streetView);
  const setStreetView = useSettingsStore((s) => s.setStreetView);
  const session = useStreetViewCaptureStore((s) => s.session);
  const hasSession = session != null;
  const pendingDriveId = useStreetViewCaptureStore((s) => s.pendingDriveId);
  const setPendingDriveId = useStreetViewCaptureStore((s) => s.setPendingDriveId);
  const [pending, setPending] = useState({ drives: 0, captures: 0, bytes: 0 });
  const [mapillaryConnecting, setMapillaryConnecting] = useState(false);

  const refreshPending = useCallback(() => {
    void getPendingTotals()
      .then(setPending)
      .catch(() => setPending({ drives: 0, captures: 0, bytes: 0 }));
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending, hasSession, pendingDriveId]);

  const toggleEnabled = async (enabled: boolean) => {
    if (!enabled) {
      setStreetView({ enabled: false });
      if (session) await endStreetViewSession();
      return;
    }
    const accepted = await confirmStreetViewConsent();
    if (accepted) setStreetView({ enabled: true });
  };

  const openPending = async () => {
    const drives = await listPendingDrives();
    if (drives[0]) setPendingDriveId(drives[0].id);
  };

  const connectMapillaryAccount = async () => {
    setMapillaryConnecting(true);
    try {
      const user = await connectMapillary();
      setStreetView({ mapillaryUsername: user.username ?? user.id });
    } catch (error) {
      Alert.alert(
        'Mapillary sign-in failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setMapillaryConnecting(false);
    }
  };

  const disconnectMapillaryAccount = () => {
    Alert.alert('Disconnect Mapillary?', 'Uploads will stop until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await disconnectMapillary();
            setStreetView({ mapillaryUsername: null });
          })();
        },
      },
    ]);
  };

  return (
    <>
      <SettingsGroup
        header="Street Imagery"
        footer="Opt-in capture while navigating. Photos include GPS, heading and capture time. Mapillary blurs faces and plates on its servers. Standard captures every 20 m; 3D uses denser spacing and the iPhone ultra-wide lens when available (much more storage). Detail frames add a telephoto frame every fifth capture on iPhones with a tele lens (standard mode only) and upload as a separate Mapillary cluster."
      >
        <SettingsRow
          title="Capture while navigating"
          rightAdornment={
            <Switch
              value={streetView.enabled}
              onValueChange={(value) => void toggleEnabled(value)}
              trackColor={{
                false: isDark ? '#39393D' : '#E5E5EA',
                true: colors.primary + 'CC',
              }}
            />
          }
        />
        <SettingsRow
          title="Capture mode"
          rightAdornment={
            <View style={styles.segment}>
              <SegmentedControl
                options={MODE_OPTIONS}
                value={streetView.mode}
                onChange={(mode) => setStreetView({ mode })}
                label="Street imagery capture mode"
              />
            </View>
          }
        />
        <SettingsRow
          title="Detail frames (telephoto)"
          rightAdornment={
            <Switch
              value={streetView.detailStream}
              disabled={!streetView.enabled}
              onValueChange={(detailStream) => setStreetView({ detailStream })}
              trackColor={{
                false: isDark ? '#39393D' : '#E5E5EA',
                true: colors.primary + 'CC',
              }}
            />
          }
        />
        <SettingsRow
          title="Auto-start on drives"
          rightAdornment={
            <Switch
              value={streetView.autoStart}
              disabled={!streetView.enabled}
              onValueChange={(value) =>
                setStreetView({ autoStart: value, autoStartPromptAnswered: true })
              }
              trackColor={{
                false: isDark ? '#39393D' : '#E5E5EA',
                true: colors.primary + 'CC',
              }}
            />
          }
        />
        <SettingsRow
          title="Upload on Wi-Fi only"
          rightAdornment={
            <Switch
              value={streetView.wifiOnly}
              onValueChange={(wifiOnly) => setStreetView({ wifiOnly })}
              trackColor={{
                false: isDark ? '#39393D' : '#E5E5EA',
                true: colors.primary + 'CC',
              }}
            />
          }
        />
        <SettingsRow
          title="Pending street imagery"
          value={
            pending.drives > 0
              ? `${pending.drives} drive${pending.drives === 1 ? '' : 's'} · ${formatBytes(pending.bytes)}`
              : 'None'
          }
          onPress={pending.drives > 0 ? () => void openPending() : undefined}
        />
      </SettingsGroup>

      <SettingsGroup
        header="Mapillary"
        footer="Mapillary is a Meta-owned street-level imagery platform. Uploads use a dedicated upload-scoped app credential embedded in this build; published photos are public. Processing and face/plate blurring happen on Mapillary's servers and can take 24–48 hours."
      >
        {isMapillaryUploadConfigured() ? (
          <>
            <SettingsRow
              title="Account"
              value={
                mapillaryConnecting
                  ? 'Connecting…'
                  : (streetView.mapillaryUsername ?? 'Connect Mapillary')
              }
              onPress={
                mapillaryConnecting
                  ? undefined
                  : streetView.mapillaryUsername
                    ? disconnectMapillaryAccount
                    : () => void connectMapillaryAccount()
              }
            />
            {streetView.mapillaryUsername ? (
              <SettingsRow
                title="Sign out of Mapillary"
                destructive
                onPress={disconnectMapillaryAccount}
              />
            ) : null}
          </>
        ) : (
          <SettingsRow title="Mapillary upload" value="Not configured in this build" />
        )}
      </SettingsGroup>
    </>
  );
}

const styles = StyleSheet.create({
  segment: { width: 150 },
});
