import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Modal } from '../common';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useStreetViewUploadStore } from '../../stores/streetViewUploadStore';
import type { StreetViewDriveSummary } from '../../models/streetViewCapture';
import {
  deleteDrive,
  deleteDriveFile,
  getDriveSummary,
  setDriveStatus,
} from '../../services/imagery/streetViewQueue';
import { loadPanoramaxAuth, uploadDriveToPanoramax } from '../../services/imagery/panoramaxService';
import {
  getValidMapillaryAuth,
  uploadDriveToMapillary,
} from '../../services/imagery/mapillaryService';
import { isMapillaryUploadConfigured } from '../../constants/config';
import { formatBytes } from '../../utils/formatBytes';
import { formatDuration } from '../../utils/units';

/**
 * End-of-drive consent gate. It shows what was captured and only uploads after
 * the user confirms a target. MVP has no per-photo review; Delete all is the
 * escape hatch.
 */
export function DriveUploadSheet() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const pendingDriveId = useStreetViewCaptureStore((s) => s.pendingDriveId);
  const setPendingDriveId = useStreetViewCaptureStore((s) => s.setPendingDriveId);
  const panoramaxInstanceUrl = useSettingsStore((s) => s.streetView.panoramaxInstanceUrl);
  const panoramaxUsername = useSettingsStore((s) => s.streetView.panoramaxUsername);
  const mapillaryUsername = useSettingsStore((s) => s.streetView.mapillaryUsername);
  const wifiOnly = useSettingsStore((s) => s.streetView.wifiOnly);
  const upload = useStreetViewUploadStore();
  const [summary, setSummary] = useState<StreetViewDriveSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAuth, setHasAuth] = useState(false);
  const [hasMapillaryAuth, setHasMapillaryAuth] = useState(false);
  const [panoramaxSelected, setPanoramaxSelected] = useState(true);
  const [mapillarySelected, setMapillarySelected] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingDriveId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    useStreetViewUploadStore.getState().reset();
    void (async () => {
      try {
        const result = await getDriveSummary(pendingDriveId);
        if (cancelled) return;
        if (!result) {
          setPendingDriveId(null);
          return;
        }
        setSummary(result);
        if (panoramaxInstanceUrl) {
          const auth = await loadPanoramaxAuth(panoramaxInstanceUrl);
          if (!cancelled) setHasAuth(Boolean(auth));
        } else if (!cancelled) {
          setHasAuth(false);
        }

        if (isMapillaryUploadConfigured()) {
          const mapAuth = await getValidMapillaryAuth().catch(() => null);
          if (!cancelled) {
            setHasMapillaryAuth(Boolean(mapAuth));
            setMapillarySelected(Boolean(mapAuth));
          }
        } else if (!cancelled) {
          setHasMapillaryAuth(false);
          setMapillarySelected(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingDriveId, panoramaxInstanceUrl, setPendingDriveId]);

  if (!pendingDriveId) return null;

  const close = () => {
    setPendingDriveId(null);
    setStage(null);
    upload.reset();
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete this drive?',
      'The captured photos will be removed from this device. Nothing will be uploaded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteDrive(pendingDriveId);
              close();
            })();
          },
        },
      ],
    );
  };

  const handleUpload = () => {
    if (!summary) return;
    const panoramaxReady = panoramaxSelected && Boolean(panoramaxInstanceUrl) && hasAuth;
    const mapillaryReady = mapillarySelected && isMapillaryUploadConfigured() && hasMapillaryAuth;

    if (!panoramaxSelected && !mapillarySelected) {
      Alert.alert('Choose a destination', 'Select Panoramax, Mapillary, or delete the drive.');
      return;
    }
    if (!panoramaxReady && !mapillaryReady) {
      Alert.alert(
        'Connect an upload target',
        'Open Settings → Street Imagery to connect Panoramax or Mapillary.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => {
              close();
              router.push('/settings');
            },
          },
        ],
      );
      return;
    }

    void (async () => {
      upload.start(summary.drive.id, summary.captures.length);
      const errors: string[] = [];
      let uploaded = 0;
      let failed = 0;

      try {
        if (panoramaxReady && panoramaxInstanceUrl) {
          const auth = await loadPanoramaxAuth(panoramaxInstanceUrl);
          if (!auth) {
            setHasAuth(false);
            errors.push('Panoramax session expired');
          } else {
            setStage('Uploading to Panoramax…');
            const result = await uploadDriveToPanoramax(summary, auth, {
              wifiOnly,
              onProgress: (progress) =>
                upload.progress(progress.uploaded, progress.failed, progress.total),
            });
            uploaded += result.uploaded;
            failed += result.failed;
            if (result.failed > 0) {
              errors.push(`${result.failed} Panoramax photo(s) failed`);
            }
          }
        }

        if (mapillaryReady) {
          const auth = await getValidMapillaryAuth();
          setStage('Uploading to Mapillary…');
          const result = await uploadDriveToMapillary(summary, auth, {
            wifiOnly,
            onProgress: (progress) =>
              upload.progress(progress.uploaded, progress.failed, progress.total),
          });
          uploaded += result.uploaded;
          failed += result.failed + result.skipped;
          if (result.failed > 0) {
            errors.push(`${result.failed} Mapillary photo(s) failed`);
          }
          if (result.skipped > 0) {
            errors.push(`${result.skipped} portrait photo(s) skipped by Mapillary`);
          }
        }

        const error = errors.length ? errors.join('; ') : null;
        upload.finish(error);
        if (!error) {
          // Every selected target accepted the files; drop the originals so a
          // long drive does not keep several GB in the document directory.
          await deleteDriveFile(summary.drive.id).catch(() => {});
          setPendingDriveId(null);
          upload.reset();
          Alert.alert(
            'Street imagery uploaded',
            `${summary.captures.length} photo${summary.captures.length === 1 ? '' : 's'} sent to the selected platforms. Panoramax and Mapillary process uploads asynchronously.`,
          );
        } else {
          await setDriveStatus(summary.drive.id, 'partial', error).catch(() => {});
          const fresh = await getDriveSummary(summary.drive.id);
          if (fresh) setSummary(fresh);
          Alert.alert(
            'Upload partly finished',
            `${uploaded} uploaded${failed > 0 ? `, ${failed} failed` : ''}. ${error}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        upload.finish(message);
        await setDriveStatus(summary.drive.id, 'partial', message).catch(() => {});
        const fresh = await getDriveSummary(summary.drive.id).catch(() => null);
        if (fresh) setSummary(fresh);
        Alert.alert('Upload not completed', message);
      } finally {
        setStage(null);
      }
    })();
  };

  const uploading = upload.status === 'uploading';
  const anyTargetReady =
    (Boolean(panoramaxInstanceUrl) && hasAuth) ||
    (isMapillaryUploadConfigured() && hasMapillaryAuth);
  const durationSeconds =
    summary?.drive.endedAt != null
      ? Math.max(0, Math.round((summary.drive.endedAt - summary.drive.startedAt) / 1000))
      : null;

  return (
    <Modal visible onClose={uploading ? () => {} : close} title="Street imagery from this drive">
      {loading || !summary ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Reading the drive…</Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.stats}>
            <Stat
              icon="images-outline"
              value={String(summary.captures.length)}
              label="photos"
              styles={styles}
              iconColor={colors.primary}
            />
            <Stat
              icon="cloud-upload-outline"
              value={formatBytes(summary.totalBytes)}
              label="to upload"
              styles={styles}
              iconColor={colors.primary}
            />
            {durationSeconds != null ? (
              <Stat
                icon="time-outline"
                value={formatDuration(durationSeconds)}
                label="drive"
                styles={styles}
                iconColor={colors.primary}
              />
            ) : null}
          </View>

          <View style={styles.targets}>
            <View style={styles.targetRow}>
              <View style={styles.targetText}>
                <Text style={styles.targetTitle}>Panoramax</Text>
                <Text style={styles.targetSubtitle} numberOfLines={1}>
                  {panoramaxInstanceUrl
                    ? `${panoramaxUsername ?? 'Connected'} · ${panoramaxInstanceUrl.replace(
                        /^https:\/\//,
                        '',
                      )}`
                    : 'No instance connected'}
                </Text>
              </View>
              <Switch
                value={panoramaxSelected && Boolean(panoramaxInstanceUrl) && hasAuth}
                onValueChange={setPanoramaxSelected}
                disabled={!panoramaxInstanceUrl || !hasAuth || uploading}
                trackColor={{
                  false: isDark ? '#39393D' : '#E5E5EA',
                  true: colors.primary + 'CC',
                }}
              />
            </View>
            {isMapillaryUploadConfigured() ? (
              <View style={styles.targetRow}>
                <View style={styles.targetText}>
                  <Text style={styles.targetTitle}>Mapillary</Text>
                  <Text style={styles.targetSubtitle} numberOfLines={1}>
                    {hasMapillaryAuth ? (mapillaryUsername ?? 'Connected') : 'Not connected'}
                  </Text>
                </View>
                <Switch
                  value={mapillarySelected && hasMapillaryAuth}
                  onValueChange={setMapillarySelected}
                  disabled={!hasMapillaryAuth || uploading}
                  trackColor={{
                    false: isDark ? '#39393D' : '#E5E5EA',
                    true: colors.primary + 'CC',
                  }}
                />
              </View>
            ) : null}
            {!anyTargetReady ? (
              <Text style={styles.hint}>
                Connect a target in Settings to upload. You can still keep or delete this drive.
              </Text>
            ) : null}
          </View>

          {uploading ? (
            <View style={styles.progressBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>
                {stage ?? `${upload.uploaded} of ${upload.total} uploaded`}
                {upload.failed > 0 ? ` · ${upload.failed} failed` : ''}
              </Text>
            </View>
          ) : null}

          {upload.status === 'failed' && upload.error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText} numberOfLines={3}>
                {upload.error}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              title={uploading ? 'Uploading…' : 'Upload'}
              onPress={handleUpload}
              disabled={uploading || !summary.captures.length}
              loading={uploading}
            />
            <Button title="Not now" variant="outline" onPress={close} disabled={uploading} />
          </View>
          <Text style={styles.footer}>
            Photos stay on this device until you upload or delete them. Mapillary blurs faces and
            plates; Panoramax blurs only on instances with a blur service enabled.
          </Text>
          <Text style={styles.delete} onPress={uploading ? undefined : handleDelete}>
            Delete all
          </Text>
        </View>
      )}
    </Modal>
  );
}

function Stat({
  icon,
  value,
  label,
  styles,
  iconColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
  iconColor: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={iconColor} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors'], isDark: boolean) =>
  StyleSheet.create({
    body: { gap: spacing.md },
    loading: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
    muted: { ...typography.caption, color: colors.textSecondary },
    stats: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderRadius: 12,
      paddingVertical: spacing.md,
    },
    stat: { alignItems: 'center', gap: 2 },
    statValue: { ...typography.h3, color: colors.text, fontSize: 18 },
    statLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
    targets: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      padding: spacing.sm,
      gap: spacing.xs,
    },
    targetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    targetText: { flex: 1 },
    targetTitle: { ...typography.body, color: colors.text, fontSize: 16, fontWeight: '600' },
    targetSubtitle: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
    hint: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
    progressBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    progressText: { ...typography.body, color: colors.text, fontSize: 14 },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: 'rgba(255,59,48,0.1)',
      borderRadius: 8,
      padding: spacing.sm,
    },
    errorText: { ...typography.caption, color: colors.error, flex: 1, fontSize: 12 },
    actions: { gap: spacing.sm },
    footer: {
      ...typography.caption,
      color: colors.textSecondary,
      fontSize: 11,
      textAlign: 'center',
    },
    delete: {
      ...typography.body,
      color: colors.error,
      fontSize: 15,
      textAlign: 'center',
      paddingVertical: spacing.xs,
    },
  });
