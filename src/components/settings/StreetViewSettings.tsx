import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SettingsGroup, SettingsRow } from '../common';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { confirmStreetViewConsent } from '../../services/imagery/streetViewConsent';
import { endStreetViewSession } from '../../services/imagery/streetViewSession';
import { connectMapillary, disconnectMapillary } from '../../services/imagery/mapillaryService';
import { isMapillaryUploadConfigured } from '../../constants/config';
import { getPendingTotals, listPendingDrives } from '../../services/imagery/streetViewQueue';
import { formatBytes } from '../../utils/formatBytes';

/**
 * Street-imagery capture and the Mapillary account it uploads to. Kept as one
 * section so the destination of the photos sits next to the capture controls.
 */
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

  const switchRow = (value: boolean, onChange: (value: boolean) => void, disabled = false) => (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{
        false: isDark ? '#39393D' : '#E5E5EA',
        true: colors.primary + 'CC',
      }}
    />
  );

  return (
    <SettingsGroup
      header="Street imagery"
      icon={<Ionicons name="camera-outline" size={15} color={colors.textSecondary} />}
      footer="Photos are public on Mapillary, which blurs faces and plates on its servers."
    >
      <SettingsRow
        title="Capture while navigating"
        rightAdornment={switchRow(streetView.enabled, (value) => void toggleEnabled(value))}
      />
      <SettingsRow
        title="Auto-start on drives"
        rightAdornment={switchRow(
          streetView.autoStart,
          (autoStart) => setStreetView({ autoStart }),
          !streetView.enabled,
        )}
      />
      <SettingsRow
        title="Telephoto detail frames"
        rightAdornment={switchRow(
          streetView.detailStream,
          (detailStream) => setStreetView({ detailStream }),
          !streetView.enabled,
        )}
      />
      <SettingsRow
        title="Wi-Fi-only uploads"
        rightAdornment={switchRow(streetView.wifiOnly, (wifiOnly) => setStreetView({ wifiOnly }))}
      />
      {isMapillaryUploadConfigured() ? (
        <>
          <SettingsRow
            title="Mapillary account"
            value={
              mapillaryConnecting ? 'Connecting…' : (streetView.mapillaryUsername ?? 'Connect')
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
              title="Disconnect Mapillary"
              destructive
              onPress={disconnectMapillaryAccount}
            />
          ) : null}
        </>
      ) : (
        <SettingsRow title="Mapillary account" value="Unavailable in this build" />
      )}
      <SettingsRow
        title="Pending uploads"
        value={
          pending.drives > 0
            ? `${pending.drives} drive${pending.drives === 1 ? '' : 's'} · ${formatBytes(pending.bytes)}`
            : 'None'
        }
        onPress={pending.drives > 0 ? () => void openPending() : undefined}
      />
    </SettingsGroup>
  );
}
