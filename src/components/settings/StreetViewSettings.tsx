import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Modal, SegmentedControl, SettingsGroup, SettingsRow } from '../common';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { confirmStreetViewConsent } from '../../services/imagery/streetViewConsent';
import { endStreetViewSession } from '../../services/imagery/streetViewSession';
import {
  connectPanoramax,
  disconnectPanoramax,
  fetchPanoramaxInstances,
  type PanoramaxInstance,
} from '../../services/imagery/panoramaxService';
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
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const streetView = useSettingsStore((s) => s.streetView);
  const setStreetView = useSettingsStore((s) => s.setStreetView);
  const session = useStreetViewCaptureStore((s) => s.session);
  const hasSession = session != null;
  const pendingDriveId = useStreetViewCaptureStore((s) => s.pendingDriveId);
  const setPendingDriveId = useStreetViewCaptureStore((s) => s.setPendingDriveId);
  const [pending, setPending] = useState({ drives: 0, captures: 0, bytes: 0 });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [connecting, setConnecting] = useState(false);
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

  const connect = async (instanceUrl?: string) => {
    const target = instanceUrl ?? streetView.panoramaxInstanceUrl;
    if (!target) {
      setPickerVisible(true);
      return;
    }
    setConnecting(true);
    try {
      const { user } = await connectPanoramax(target);
      setStreetView({ panoramaxUsername: user.name });
    } catch (error) {
      Alert.alert(
        'Panoramax sign-in failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    const instance = streetView.panoramaxInstanceUrl;
    if (!instance) return;
    Alert.alert('Disconnect Panoramax?', 'The local upload credential will be revoked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await disconnectPanoramax(instance);
            setStreetView({ panoramaxUsername: null });
          })();
        },
      },
    ]);
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
        footer="Opt-in capture while navigating. Photos include GPS, heading and capture time. Mapillary blurs faces and plates on its servers; Panoramax instances blur when the instance has a blur service enabled. Standard captures every 20 m; 3D uses denser spacing and the iPhone ultra-wide lens when available (much more storage)."
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
        header="Panoramax"
        footer="Panoramax is an open, federated street-level imagery platform. Choose an instance from the public catalog, then sign in there. Uploads are public by default on most instances."
      >
        <SettingsRow
          title="Instance"
          value={
            streetView.panoramaxInstanceUrl
              ? streetView.panoramaxInstanceUrl.replace(/^https:\/\//, '')
              : 'Choose instance'
          }
          onPress={() => setPickerVisible(true)}
        />
        <SettingsRow
          title="Account"
          value={connecting ? 'Connecting…' : (streetView.panoramaxUsername ?? 'Sign in')}
          onPress={
            connecting
              ? undefined
              : streetView.panoramaxUsername
                ? disconnect
                : () => void connect()
          }
        />
        {streetView.panoramaxUsername ? (
          <SettingsRow title="Sign out of Panoramax" destructive onPress={disconnect} />
        ) : null}
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

      <PanoramaxInstancePicker
        visible={pickerVisible}
        selectedUrl={streetView.panoramaxInstanceUrl}
        onClose={() => setPickerVisible(false)}
        onSelect={(instance) => {
          setPickerVisible(false);
          setStreetView({
            panoramaxInstanceUrl: instance.url,
            panoramaxUsername: null,
          });
          Alert.alert('Instance selected', `Now sign in to ${instance.name} to enable uploads.`, [
            { text: 'OK', onPress: () => void connect(instance.url) },
          ]);
        }}
      />
    </>
  );
}

function PanoramaxInstancePicker({
  visible,
  selectedUrl,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selectedUrl: string | null;
  onClose: () => void;
  onSelect: (instance: PanoramaxInstance) => void;
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [instances, setInstances] = useState<PanoramaxInstance[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchPanoramaxInstances(reloadKey > 0)
      .then((items) => {
        if (!cancelled) setInstances(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return instances;
    return instances.filter(
      (instance) =>
        instance.name.toLowerCase().includes(q) || instance.url.toLowerCase().includes(q),
    );
  }, [instances, query]);

  return (
    <Modal visible={visible} onClose={onClose} title="Choose a Panoramax instance">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search instances"
        placeholderTextColor={colors.textSecondary}
        style={styles.search}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {loading ? (
        <View style={styles.pickerLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading the public catalog…</Text>
        </View>
      ) : error ? (
        <View style={styles.pickerLoading}>
          <Text style={styles.error}>{error}</Text>
          <Button
            title="Try again"
            variant="outline"
            onPress={() => setReloadKey((key) => key + 1)}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.url}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const unavailable = !item.authEnabled;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.instanceRow,
                  pressed && !unavailable ? styles.pressed : null,
                  unavailable ? styles.instanceRowDisabled : null,
                ]}
                onPress={() => onSelect(item)}
                disabled={unavailable}
                accessibilityRole="button"
                accessibilityState={{ disabled: unavailable }}
                accessibilityLabel={
                  unavailable ? `${item.name}, sign-in not available` : `Use ${item.name}`
                }
              >
                <View style={styles.instanceText}>
                  <Text style={styles.instanceName}>{item.name}</Text>
                  <Text style={styles.instanceUrl} numberOfLines={1}>
                    {unavailable
                      ? 'Accounts are disabled on this instance'
                      : item.url.replace(/^https:\/\//, '')}
                  </Text>
                </View>
                {unavailable ? (
                  <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
                ) : selectedUrl === item.url ? (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.muted}>No instances match “{query}”.</Text>}
        />
      )}
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors'], isDark: boolean) =>
  StyleSheet.create({
    segment: { width: 150 },
    search: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      marginBottom: spacing.sm,
    },
    list: { maxHeight: 360 },
    pickerLoading: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
    muted: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
    error: { ...typography.caption, color: colors.error, textAlign: 'center' },
    instanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pressed: { opacity: 0.7 },
    instanceRowDisabled: { opacity: 0.55 },
    instanceText: { flex: 1 },
    instanceName: { ...typography.body, color: colors.text, fontSize: 15, fontWeight: '600' },
    instanceUrl: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  });
