import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Button } from '../common';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useAtprotoAuthStore } from '../../stores/atprotoAuthStore';
import { useReviewImportStore } from '../../stores/reviewImportStore';
import { parseGoogleReviewsJson } from '../../services/reviews/googleReviewsImport';
import { REVIEWS_FILE_STEPS, TAKEOUT_REQUEST_STEPS } from './takeoutCopy';

/**
 * Google-reviews import panel, shown inside a modal.
 *
 * Gated on Bluesky login: imported reviews are published to the user's PDS,
 * so logged-out users see an explanation plus a sign-in nudge instead of the
 * picker. Logged-in users get concise file-location instructions, a picker,
 * and a one-by-one background import with live progress.
 */
export function GoogleReviewsImport() {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(), [colors]);
  const router = useRouter();

  const session = useAtprotoAuthStore((s) => s.session);
  const pending = useReviewImportStore((s) => s.pending);
  const setPending = useReviewImportStore((s) => s.setPending);
  const start = useReviewImportStore((s) => s.start);
  const cancel = useReviewImportStore((s) => s.cancel);
  const status = useReviewImportStore((s) => s.status);
  const progress = useReviewImportStore((s) => s.progress);
  const error = useReviewImportStore((s) => s.error);
  const clearTakeoutReminder = useReviewImportStore((s) => s.clearTakeoutReminder);
  const [starting, setStarting] = useState(false);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'public.data'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const parsed = parseGoogleReviewsJson(content);
      if (parsed.length === 0) {
        Alert.alert(
          'No reviews found',
          'That file parsed but contained no usable reviews (each entry needs a name, coordinates, and a 1–5 star rating).',
        );
        return;
      }
      setPending(parsed);
    } catch (e) {
      Alert.alert('Import Error', (e as Error).message || 'Could not read file');
    }
  }, [setPending]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await start();
      clearTakeoutReminder();
    } finally {
      setStarting(false);
    }
  }, [start, clearTakeoutReminder]);

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.text }]}>Bring your Google reviews</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Imported reviews are published to your Bluesky account, so they need a login first. Once
          signed in, your Takeout Reviews.json is matched place-by-place and each star rating is
          re-posted as your own Polaris review.
        </Text>
        <Button title="Sign in with Bluesky in Settings" onPress={() => router.push('/settings')} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          No Takeout yet? Request it at takeout.google.com (Deselect all → Maps → Create export) —
          it usually takes a few hours.
        </Text>
      </View>
    );
  }

  const running = status === 'running';
  const finished = status === 'done' || status === 'cancelled';

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Import Google reviews</Text>

      {pending.length === 0 && !running && !finished && (
        <>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Find Reviews.json in your Takeout download:
          </Text>
          {REVIEWS_FILE_STEPS.map((step, i) => (
            <Text key={i} style={[styles.step, { color: colors.textSecondary }]}>
              {i + 1}. {step}
            </Text>
          ))}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            No Takeout yet? {TAKEOUT_REQUEST_STEPS[0]} {TAKEOUT_REQUEST_STEPS[1]}
          </Text>
          <Button title="Choose Reviews.json" onPress={handlePickFile} />
        </>
      )}

      {pending.length > 0 && !running && !finished && (
        <>
          <Text style={[styles.body, { color: colors.text }]}>
            {pending.length} review{pending.length !== 1 ? 's' : ''} ready. They import one by one
            in the background (a few seconds apart to stay friendly with Bluesky). You can leave
            this screen — unmatched places are skipped and reported at the end.
          </Text>
          <Button
            title={starting ? 'Starting…' : `Import ${pending.length} reviews`}
            onPress={handleStart}
            disabled={starting}
          />
          <Button title="Choose a different file" onPress={handlePickFile} variant="ghost" />
        </>
      )}

      {(running || finished) && (
        <>
          <Text style={[styles.body, { color: colors.text }]}>
            {progress.completed} of {progress.total} · {progress.imported} published
            {progress.unmatched.length > 0 ? ` · ${progress.unmatched.length} unmatched` : ''}
            {progress.failed.length > 0 ? ` · ${progress.failed.length} failed` : ''}
          </Text>
          {running && <Button title="Cancel" onPress={cancel} variant="outline" />}
          {finished && (
            <>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {status === 'cancelled' ? 'Import stopped. ' : ''}
                {progress.imported} published, {progress.unmatched.length} skipped (no matching
                place found), {progress.failed.length} failed.
                {progress.unmatched.length > 0 &&
                  ` Skipped: ${progress.unmatched.slice(0, 5).join(', ')}${progress.unmatched.length > 5 ? '…' : ''}`}
              </Text>
              <Button title="Choose another file" onPress={handlePickFile} variant="outline" />
            </>
          )}
        </>
      )}

      {error && <Text style={[styles.error, { color: '#e53935' }]}>{error}</Text>}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    container: { gap: spacing.sm },
    title: { ...typography.h2 },
    body: { ...typography.body },
    step: { ...typography.body, paddingLeft: spacing.sm },
    hint: { ...typography.caption },
    error: { ...typography.caption },
  });
}
