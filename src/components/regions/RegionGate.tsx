import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { colors, darkColors, spacing, typography, borderRadius } from '../../constants/theme';
import { DownloadProgressBar } from './DownloadProgressBar';
import { LoadingSpinner } from '../common';
import { upsertRegion, getAllRegions } from '../../services/regions/regionRepository';
import { fetchAndSeedCatalog } from '../../services/regions/catalogService';
import { pickNearestPackRegion } from '../../services/regions/nearestPackRegion';
import type { Region } from '../../models/region';
import { downloadRegion, type DownloadProgress } from '../../services/regions/downloadService';

interface RegionGateProps {
  /** True while location/DB check is still running — shows a spinner. */
  checking: boolean;
  userLat?: number;
  userLng?: number;
  /** Called when the user either completes a download or taps "Skip for Now". */
  onDismiss: () => void;
}

/**
 * First-run offer of the offline pack for the user's area.
 *
 * Packs are the only offline source offered anywhere in the app. This used to
 * also show the Geofabrik tree — a second, separate way to download maps that
 * capped at 50 MB per download and failed on anything large. Two download
 * systems for the same thing is not a choice a user should have to make, so the
 * gate offers the nearest published pack and nothing else.
 */
export function RegionGate({ checking, userLat, userLng, onDismiss }: RegionGateProps) {
  const { isDark } = useTheme();
  const c = isDark ? darkColors : colors;

  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [packDownloading, setPackDownloading] = useState(false);
  const [packDownloaded, setPackDownloaded] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [allRegions, setAllRegions] = useState<Region[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Nearest published pack to the user, else null when the catalog is empty. */
  const suggestedPack = useMemo(
    () => pickNearestPackRegion(allRegions, userLat, userLng),
    [allRegions, userLat, userLng],
  );

  useEffect(() => {
    let cancelled = false;
    // Cached catalog seeds instantly; the network refresh follows. Either way
    // the region table is what `pickNearestPackRegion` reads.
    void fetchAndSeedCatalog()
      .catch(() => undefined)
      .then(() => getAllRegions())
      .then((regions) => {
        if (cancelled) return;
        setAllRegions(regions);
        setCatalogLoaded(true);
        const already = pickNearestPackRegion(regions, userLat, userLng);
        if (already?.downloadStatus === 'complete') setPackDownloaded(true);
      })
      .catch(() => {
        if (!cancelled) setCatalogLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userLat, userLng]);

  const handleDownloadPack = useCallback(
    async (region: Region) => {
      if (packDownloading) return;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setPackDownloading(true);
      setProgress(null);
      try {
        await upsertRegion(region);
        await downloadRegion(region, (p) => setProgress(p), controller.signal);
        if (!controller.signal.aborted) setPackDownloaded(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          Alert.alert('Download Failed', err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        abortControllerRef.current = null;
        setPackDownloading(false);
      }
    },
    [packDownloading],
  );

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setProgress(null);
  }, []);

  if (checking || !catalogLoaded) {
    return (
      <View style={[styles.overlay, styles.centered, { backgroundColor: c.background }]}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.overlay, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: c.text }]}>Download your map</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>
          One download gives you offline maps, routing and local search for your area. You can add
          more areas later in Settings → Download Regions.
        </Text>

        {suggestedPack ? (
          <View style={[styles.packCard, { borderColor: c.primary }]}>
            <Text style={[styles.packEyebrow, { color: c.primary }]}>
              {userLat != null ? 'YOUR AREA' : 'SUGGESTED'}
            </Text>
            <Text style={[styles.packName, { color: c.text }]}>{suggestedPack.name}</Text>
            <Text style={[styles.packNote, { color: c.textSecondary }]}>
              Offline maps, routing and search — no size limit.
            </Text>
            <TouchableOpacity
              style={[
                styles.packBtn,
                {
                  backgroundColor: packDownloaded ? c.surface : c.primary,
                  opacity: packDownloading ? 0.6 : 1,
                },
              ]}
              onPress={() => void handleDownloadPack(suggestedPack)}
              disabled={packDownloaded || packDownloading}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.packBtnText, { color: packDownloaded ? c.textSecondary : '#fff' }]}
              >
                {packDownloaded ? 'Downloaded' : packDownloading ? 'Downloading…' : 'Download'}
              </Text>
            </TouchableOpacity>

            {progress && packDownloading && (
              <View style={styles.progressWrapper}>
                <DownloadProgressBar progress={progress} />
                <TouchableOpacity onPress={handleCancel} activeOpacity={0.7}>
                  <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <Text style={[styles.hint, { color: c.textSecondary }]}>
            No map packs are published yet. You can add one later in Settings → Download Regions.
          </Text>
        )}

        {packDownloaded && (
          <TouchableOpacity
            style={[styles.openBtn, { backgroundColor: c.primary }]}
            onPress={onDismiss}
            activeOpacity={0.85}
          >
            <Text style={styles.openBtnText}>Open App</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.skipBtn} onPress={onDismiss} activeOpacity={0.7}>
          <Text style={[styles.skipText, { color: c.textSecondary }]}>Skip for Now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 999,
  },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.h2,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    marginBottom: spacing.lg,
  },
  hint: {
    ...typography.body,
    marginBottom: spacing.lg,
  },
  packCard: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  packEyebrow: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  packName: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  packNote: {
    ...typography.body,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  packBtn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  packBtnText: {
    ...typography.body,
    fontWeight: '600',
  },
  progressWrapper: { marginTop: spacing.md },
  cancelText: {
    ...typography.body,
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  openBtn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  openBtnText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '600',
  },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  skipText: {
    ...typography.body,
    fontSize: 14,
  },
});
