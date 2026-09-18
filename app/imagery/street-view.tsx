import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PanoramaViewer } from '../../src/components/imagery/PanoramaViewer';
import { LoadingSpinner, ErrorBoundary } from '../../src/components/common';
import { spacing, typography, borderRadius } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useThemedStyles, type Theme } from '../../src/hooks/useThemedStyles';
import {
  findStreetViewPanoramas,
  isMapillaryConfigured,
  type StreetViewPanorama,
} from '../../src/services/imagery/streetViewService';

/**
 * 3D street-level viewer. Merges open Panoramax panoramas with (token-gated)
 * Mapillary coverage around a coordinate and renders them in an equirectangular
 * WebGL viewer. Online-only supplement to the P2P street imagery feed.
 */
export default function StreetViewScreen() {
  const { lat, lng, name } = useLocalSearchParams<{ lat?: string; lng?: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [panoramas, setPanoramas] = useState<StreetViewPanorama[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  const latNum = lat ? parseFloat(lat) : NaN;
  const lngNum = lng ? parseFloat(lng) : NaN;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        if (!cancelled) setLoading(false);
        return;
      }
      const found = await findStreetViewPanoramas(latNum, lngNum, {
        includeMapillary: isMapillaryConfigured(),
      });
      if (!cancelled) {
        setPanoramas(found);
        setIndex(0);
        setFallbackNotice(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latNum, lngNum]);

  const current = panoramas[index];

  const goTo = useCallback(
    (delta: number) => {
      setFallbackNotice(null);
      setIndex((i) => Math.min(panoramas.length - 1, Math.max(0, i + delta)));
    },
    [panoramas.length],
  );

  const openLicense = useCallback(() => {
    if (current?.licenseUrl) void Linking.openURL(current.licenseUrl).catch(() => undefined);
  }, [current]);

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        {loading ? (
          <View style={styles.center}>
            <LoadingSpinner size="large" />
          </View>
        ) : !current ? (
          <View style={styles.center}>
            <Ionicons name="camera-outline" size={32} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No street-level imagery here yet</Text>
            {!isMapillaryConfigured() && (
              <Text style={styles.emptyHint}>
                Add a Mapillary token to widen street-level coverage.
              </Text>
            )}
          </View>
        ) : (
          <>
            <PanoramaViewer
              key={current.id}
              imageUrl={current.imageUrl}
              initialYaw={current.bearing ?? 0}
              onError={(message) =>
                setFallbackNotice(message === 'fallback' ? 'Showing a flat preview' : message)
              }
              testID="street-view-panorama"
            />

            <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close street view"
                onPress={() => router.back()}
                hitSlop={8}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
              <View style={styles.titleBlock}>
                {name ? (
                  <Text style={styles.title} numberOfLines={1}>
                    {name}
                  </Text>
                ) : null}
                <Text style={styles.subtitle} numberOfLines={1}>
                  {current.source === 'mapillary' ? 'Mapillary' : 'Panoramax'} · {index + 1}/
                  {panoramas.length}
                </Text>
              </View>
              <View style={styles.iconButton} />
            </View>

            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous panorama"
                onPress={() => goTo(-1)}
                disabled={index === 0}
                style={[styles.navButton, index === 0 && styles.navButtonDisabled]}
              >
                <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
              </Pressable>

              <Pressable
                onPress={openLicense}
                disabled={!current.licenseUrl}
                accessibilityRole={current.licenseUrl ? 'link' : 'text'}
                accessibilityLabel="Photo attribution and license"
                style={styles.attribution}
              >
                <Text style={styles.attributionText} numberOfLines={2}>
                  {current.attribution}
                  {current.contributor ? ` · ${current.contributor}` : ''}
                  {fallbackNotice ? `\n${fallbackNotice}` : ''}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next panorama"
                onPress={() => goTo(1)}
                disabled={index >= panoramas.length - 1}
                style={[
                  styles.navButton,
                  index >= panoramas.length - 1 && styles.navButtonDisabled,
                ]}
              >
                <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ErrorBoundary>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000000' },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    emptyText: { ...typography.body, color: colors.text },
    emptyHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleBlock: { flex: 1, alignItems: 'center' },
    title: { ...typography.body, color: '#FFFFFF', fontWeight: '600' },
    subtitle: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
    bottomBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    navButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    navButtonDisabled: { opacity: 0.35 },
    attribution: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    attributionText: { ...typography.caption, color: '#FFFFFF' },
  });
