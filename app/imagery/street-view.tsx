import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  sortPanoramasByRecency,
  type StreetViewPanorama,
} from '../../src/services/imagery/streetViewService';

const SOURCE_LABELS: Record<StreetViewPanorama['source'], string> = {
  mapillary: 'Mapillary',
  panoramax: 'Panoramax',
};

/** Human-readable capture date for the timeline (e.g. "Sep 5, 2025"). */
function formatCaptureDate(capturedAt?: number): string {
  if (!capturedAt) return 'Date unknown';
  const date = new Date(capturedAt * 1000);
  if (Number.isNaN(date.getTime())) return 'Date unknown';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * 3D street-level viewer. Merges open Panoramax panoramas with (token-gated)
 * Mapillary coverage around a coordinate and renders them in an equirectangular
 * WebGL viewer. Online-only supplement to the P2P street imagery feed.
 *
 * Opens on the most recent capture from either source, with a timeline dropdown
 * (newest first) to step back through earlier captures, rather than paging a
 * carousel of captures for the same spot.
 */
export default function StreetViewScreen() {
  const { lat, lng, name } = useLocalSearchParams<{ lat?: string; lng?: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [captures, setCaptures] = useState<StreetViewPanorama[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  const latNum = lat ? parseFloat(lat) : NaN;
  const lngNum = lng ? parseFloat(lng) : NaN;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTimelineOpen(false);
    (async () => {
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        if (!cancelled) setLoading(false);
        return;
      }
      const found = await findStreetViewPanoramas(latNum, lngNum, {
        includeMapillary: isMapillaryConfigured(),
      });
      if (!cancelled) {
        // Newest capture from either source leads; earlier captures follow.
        setCaptures(sortPanoramasByRecency(found));
        setIndex(0);
        setFallbackNotice(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latNum, lngNum]);

  const current = captures[index];

  const selectCapture = useCallback((next: number) => {
    setFallbackNotice(null);
    setTimelineOpen(false);
    setIndex(next);
  }, []);

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

            {timelineOpen && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close capture list"
                style={styles.backdrop}
                onPress={() => setTimelineOpen(false)}
              />
            )}

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

              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Capture date ${formatCaptureDate(current.capturedAt)}, ${SOURCE_LABELS[current.source]}. Open capture timeline`}
                accessibilityState={{ expanded: timelineOpen }}
                testID="street-view-capture-selector"
                onPress={() => setTimelineOpen((open) => !open)}
                style={styles.selector}
              >
                {name ? (
                  <Text style={styles.selectorTitle} numberOfLines={1}>
                    {name}
                  </Text>
                ) : null}
                <View style={styles.selectorRow}>
                  <Text style={styles.selectorDate} numberOfLines={1}>
                    {formatCaptureDate(current.capturedAt)}
                  </Text>
                  <Ionicons
                    name={timelineOpen ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#FFFFFF"
                    style={styles.selectorChevron}
                  />
                </View>
                <Text style={styles.selectorMeta} numberOfLines={1}>
                  {SOURCE_LABELS[current.source]} · {captures.length} capture
                  {captures.length === 1 ? '' : 's'}
                </Text>
              </Pressable>

              <View style={styles.iconButton} />
            </View>

            {timelineOpen && (
              <View
                style={[styles.timelinePanel, { top: insets.top + (name ? 88 : 66) }]}
                testID="street-view-timeline"
              >
                <Text style={styles.timelineTitle}>Captures</Text>
                <ScrollView
                  style={styles.timelineScroll}
                  contentContainerStyle={styles.timelineScrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {captures.map((capture, i) => {
                    const selected = i === index;
                    const date = formatCaptureDate(capture.capturedAt);
                    const source = SOURCE_LABELS[capture.source];
                    return (
                      <Pressable
                        key={capture.id}
                        testID={`street-view-capture-${i}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${date}, ${source}${capture.contributor ? `, by ${capture.contributor}` : ''}`}
                        onPress={() => selectCapture(i)}
                        style={[styles.timelineRow, selected && styles.timelineRowSelected]}
                      >
                        <View style={styles.timelineRowText}>
                          <Text style={styles.timelineRowDate}>{date}</Text>
                          <Text style={styles.timelineRowMeta} numberOfLines={1}>
                            {source}
                            {capture.contributor ? ` · ${capture.contributor}` : ''}
                          </Text>
                        </View>
                        {selected && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
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
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selector: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.md,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    selectorTitle: { ...typography.body, color: '#FFFFFF', fontWeight: '600' },
    selectorRow: { flexDirection: 'row', alignItems: 'center' },
    selectorDate: { ...typography.body, color: '#FFFFFF', fontWeight: '600' },
    selectorChevron: { marginLeft: spacing.xs },
    selectorMeta: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
    timelinePanel: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      maxHeight: 360,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderRadius: borderRadius.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
      overflow: 'hidden',
    },
    timelineTitle: {
      ...typography.caption,
      color: 'rgba(255,255,255,0.7)',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
    },
    timelineScroll: { flexGrow: 0 },
    timelineScrollContent: { paddingHorizontal: spacing.xs },
    timelineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
    },
    timelineRowSelected: { backgroundColor: 'rgba(255,255,255,0.12)' },
    timelineRowText: { flex: 1 },
    timelineRowDate: { ...typography.body, color: '#FFFFFF' },
    timelineRowMeta: { ...typography.caption, color: 'rgba(255,255,255,0.7)' },
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
    attribution: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    attributionText: { ...typography.caption, color: '#FFFFFF' },
  });
