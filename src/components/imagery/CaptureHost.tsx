import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { dashCamElapsedSeconds, useDashCamStore } from '../../stores/dashCamStore';
import {
  buildCaptureExif,
  captureConfigForMode,
  shouldCapture,
  type LastCapture,
} from '../../services/imagery/streetViewCaptureLogic';
import {
  ensureStreetViewDriveDir,
  getLocalFileSize,
  insertCapture,
} from '../../services/imagery/streetViewQueue';
import {
  discardStreetViewSession,
  endStreetViewSession,
} from '../../services/imagery/streetViewSession';
import {
  ensureDashCamDir,
  insertDashCamClip,
  pruneDashCamClips,
} from '../../services/dashcam/dashCamQueue';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 54;

/** The live preview owns the bottom quarter of the navigation screen. */
const BAND_SCREEN_FRACTION = 0.25;
const BAND_MIN_HEIGHT = 150;
/** Stop recording rather than fill the last of the device's free space. */
const MIN_FREE_BYTES = 300 * 1024 * 1024;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pair = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pair(minutes)}:${pair(seconds)}`
    : `${pair(minutes)}:${pair(seconds)}`;
}

/**
 * Owns the single CameraView used for on-drive capture: street-imagery stills
 * and the rolling dash-cam buffer.
 *
 * It is mounted only while something is capturing, but lives at the app root
 * so tab changes and the CarPlay companion screen cannot unmount the camera
 * mid-drive. Frames are triggered by raw GPS fixes from the navigation
 * pipeline, not a timer.
 *
 * The dash cam records in fixed-length segments; each finished segment is moved
 * into the documents directory and the oldest segments are pruned once either
 * retention cap is exceeded.
 *
 * Known limitation: expo-camera binds either the photo output or the movie
 * output, so still capture and video recording cannot run at the same time.
 * Starting one is refused while the other is active; the VisionCamera migration
 * removes that restriction.
 */
export function CaptureHost() {
  const session = useStreetViewCaptureStore((s) => s.session);
  const recordCapture = useStreetViewCaptureStore((s) => s.recordCapture);
  const setSessionError = useStreetViewCaptureStore((s) => s.setSessionError);
  const mode = useSettingsStore((s) => s.streetView.mode);
  const dashRecording = useDashCamStore((s) => s.recording);
  const dashPaused = useDashCamStore((s) => s.paused);
  const recordClip = useDashCamStore((s) => s.recordClip);
  const setDashCamPaused = useDashCamStore((s) => s.setPaused);
  const setDashCamError = useDashCamStore((s) => s.setError);
  const clipSeconds = useSettingsStore((s) => s.dashCam.clipSeconds);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [selectedLens, setSelectedLens] = useState<string | null>(null);
  const [pictureSize, setPictureSize] = useState<string | null>(null);
  const [lensLabel, setLensLabel] = useState(mode === 'threeD' ? '3D' : '1×');
  const [mountError, setMountError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const busyRef = useRef(false);
  const lastCaptureRef = useRef<LastCapture | null>(null);
  const resolvedModeRef = useRef<string | null>(null);
  const permissionRequestedRef = useRef(false);
  const lastStorageCheckRef = useRef(0);
  const activeRef = useRef(appActive);
  activeRef.current = appActive;

  const config = captureConfigForMode(mode);
  const captureActive = Boolean(session) || dashRecording;
  // Only the navigation screen splits into "directions on top, live camera in
  // the bottom quarter"; every other screen keeps the compact pill so the map
  // and lists are not covered while a drive is running.
  const expanded = captureActive && Boolean(pathname?.includes('navigation'));
  const bandHeight = Math.max(BAND_MIN_HEIGHT, Math.round(windowHeight * BAND_SCREEN_FRACTION));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  // Elapsed clock for the dash-cam overlay.
  useEffect(() => {
    if (!dashRecording) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(dashCamElapsedSeconds());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [dashRecording]);

  // Ask for camera permission once. A denial ends the drive cleanly instead of
  // leaving an empty queue entry behind.
  useEffect(() => {
    if (!captureActive) return;
    if (!permission || permission.granted || permissionRequestedRef.current) return;
    permissionRequestedRef.current = true;
    void requestPermission().then((result) => {
      if (result.granted) return;
      Alert.alert(
        'Camera access needed',
        'Street imagery and dash-cam recording need camera access. You can enable it later in Settings.',
      );
      // Do not immediately retry on the next drive; the OS will not prompt
      // again until the user changes the permission in Settings.
      useSettingsStore.getState().setStreetView({ autoStart: false });
      useDashCamStore.getState().stop();
      void discardStreetViewSession();
    });
  }, [captureActive, permission, requestPermission]);

  // Resolve lens and still size when the camera becomes ready. On iOS the
  // ultra-wide is selected by lens name; 0.5× cannot be reached through `zoom`
  // (its minimum is 1×).
  const onCameraReady = useCallback(async () => {
    setReady(true);
    setMountError(null);
    if (resolvedModeRef.current === mode) return;
    resolvedModeRef.current = mode;

    if (mode === 'threeD' && Platform.OS === 'ios') {
      try {
        const lenses = await cameraRef.current?.getAvailableLensesAsync?.();
        const ultra = lenses?.find((lens) => /ultra/i.test(lens));
        if (ultra) {
          setSelectedLens(ultra);
          setLensLabel('0.5×');
          return;
        }
        setSelectedLens(null);
        setLensLabel('1×');
      } catch {
        setSelectedLens(null);
        setLensLabel('1×');
      }
    } else {
      setSelectedLens(null);
      setLensLabel(mode === 'threeD' ? '1×' : '1×');
    }

    if (mode === 'standard') {
      try {
        const sizes = await cameraRef.current?.getAvailablePictureSizesAsync?.();
        setPictureSize(sizes?.includes('1920x1080') ? '1920x1080' : null);
      } catch {
        setPictureSize(null);
      }
    } else {
      setPictureSize(null);
    }
  }, [mode]);

  const takePicture = useCallback(async () => {
    // One camera output at a time: the dash cam owns it while recording.
    if (useDashCamStore.getState().recording) return;
    if (!ready || busyRef.current || !activeRef.current) return;
    const currentSession = useStreetViewCaptureStore.getState().session;
    if (!currentSession) return;

    const settings = useSettingsStore.getState().streetView;
    const maxStorage = settings.maxStorageBytes;
    if (currentSession.bytes >= maxStorage) {
      Alert.alert(
        'Street imagery storage full',
        'Capture has stopped. Upload or delete the saved photos to free space.',
      );
      void endStreetViewSession();
      return;
    }

    const now = Date.now();
    if (now - lastStorageCheckRef.current > 30_000) {
      lastStorageCheckRef.current = now;
      const free = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
      if (free != null && free < MIN_FREE_BYTES) {
        Alert.alert(
          'Not enough free space',
          'Street imagery capture stopped because the device is low on storage.',
        );
        void endStreetViewSession();
        return;
      }
    }

    const fix = useNavigationTrackingStore.getState().rawFix;
    // Never stamp a stale fix (e.g. the last background fix) onto a frame
    // captured after the app resumes.
    if (!fix || now - fix.timestamp > 3000) return;
    const decision = shouldCapture(fix, lastCaptureRef.current, now, config);
    if (!decision.capture || !cameraRef.current) return;

    busyRef.current = true;
    try {
      const capturedAt = Date.now();
      const tracking = useNavigationTrackingStore.getState();
      const picture = await cameraRef.current.takePictureAsync({
        quality: config.quality,
        exif: true,
        additionalExif: buildCaptureExif(
          fix,
          capturedAt,
          // The store's bearing defaults to 0 before any fix; only use it as a
          // heading fallback once a navigation position exists.
          tracking.navPosition ? tracking.navBearing : null,
        ),
        shutterSound: false,
        skipProcessing: false,
      });
      if (!picture) return;

      const dir = await ensureStreetViewDriveDir(currentSession.driveId);
      const id = Crypto.randomUUID();
      const dest = `${dir}${id}.jpg`;
      await FileSystem.copyAsync({ from: picture.uri, to: dest });
      await FileSystem.deleteAsync(picture.uri, { idempotent: true }).catch(() => {});
      const bytes = await getLocalFileSize(dest);

      await insertCapture({
        id,
        driveId: currentSession.driveId,
        localUri: dest,
        lat: fix.lat,
        lng: fix.lng,
        altitude: fix.altitude,
        heading: fix.heading,
        speedMps: fix.speedMps,
        capturedAt,
        width: picture.width,
        height: picture.height,
        bytes,
      });

      lastCaptureRef.current = { lat: fix.lat, lng: fix.lng, capturedAt };
      recordCapture(bytes);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
    }
  }, [config, ready, recordCapture, setSessionError]);

  // The raw fix is published on every navigation tick (1 Hz). A new object is
  // emitted per fix, but guard on the timestamp so a re-render cannot double
  // fire a frame.
  const rawFix = useNavigationTrackingStore((s) => s.rawFix);
  const lastTriggeredFixRef = useRef<number | null>(null);
  useEffect(() => {
    if (!rawFix || rawFix.timestamp === lastTriggeredFixRef.current) return;
    lastTriggeredFixRef.current = rawFix.timestamp;
    void takePicture();
  }, [rawFix, takePicture]);

  /** Saves one finished segment and enforces the rolling retention caps. */
  const persistClip = useCallback(
    async (uri: string, startedAt: number, durationMs: number) => {
      const dir = await ensureDashCamDir();
      const id = Crypto.randomUUID();
      const dest = `${dir}${id}.mp4`;
      await FileSystem.moveAsync({ from: uri, to: dest }).catch(async () => {
        await FileSystem.copyAsync({ from: uri, to: dest });
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      });
      const info = await FileSystem.getInfoAsync(dest);
      const bytes = info.exists && typeof info.size === 'number' ? info.size : 0;
      await insertDashCamClip({
        id,
        localUri: dest,
        startedAt,
        durationMs,
        bytes,
        createdAt: Date.now(),
      });
      recordClip(bytes);
      const { maxMinutes, maxBytes } = useSettingsStore.getState().dashCam;
      await pruneDashCamClips({ maxMinutes, maxBytes });
    },
    [recordClip],
  );

  // Segmented loop recorder. Each `recordAsync` call stops at `clipSeconds`, so
  // the buffer is a series of files rather than one unbounded recording. The
  // loop pauses while the app is not active (the camera session stops when the
  // phone locks) and resumes from the next segment.
  useEffect(() => {
    if (!dashRecording || !ready) return;
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        if (!activeRef.current) {
          setDashCamPaused(true);
          await delay(500);
          continue;
        }
        setDashCamPaused(false);

        const startedAt = Date.now();
        let clip: { uri: string } | undefined;
        try {
          clip = await cameraRef.current?.recordAsync({ maxDuration: clipSeconds });
        } catch (error) {
          setDashCamError(error instanceof Error ? error.message : String(error));
          await delay(1000);
          continue;
        }
        if (!clip?.uri) {
          await delay(500);
          continue;
        }

        try {
          await persistClip(clip.uri, startedAt, Date.now() - startedAt);
        } catch (error) {
          setDashCamError(error instanceof Error ? error.message : String(error));
        }
        if (cancelled) break;

        const free = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
        if (free != null && free < MIN_FREE_BYTES) {
          Alert.alert(
            'Dash cam stopped',
            'Recording stopped because the device is low on storage. Old clips can be deleted in Settings → Dash cam.',
          );
          useDashCamStore.getState().stop();
          break;
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      cameraRef.current?.stopRecording();
      setDashCamPaused(false);
    };
  }, [dashRecording, ready, clipSeconds, persistClip, setDashCamError, setDashCamPaused]);

  if (!session && !dashRecording) return null;

  const handleStop = () => {
    if (useDashCamStore.getState().recording) {
      useDashCamStore.getState().stop();
      cameraRef.current?.stopRecording();
      return;
    }
    void endStreetViewSession();
  };

  const camera = (
    <CameraView
      ref={cameraRef}
      style={StyleSheet.absoluteFill}
      facing="back"
      mode={dashRecording ? 'video' : 'picture'}
      mute
      active={appActive}
      animateShutter={false}
      responsiveOrientationWhenOrientationLocked
      selectedLens={selectedLens ?? undefined}
      pictureSize={dashRecording ? undefined : (pictureSize ?? undefined)}
      onCameraReady={onCameraReady}
      onMountError={(event) => {
        setMountError(event.message);
        Alert.alert(
          'Camera unavailable',
          event.message || 'The camera could not start. Stop other camera apps and try again.',
        );
        const store = useStreetViewCaptureStore.getState();
        useDashCamStore.getState().stop();
        if (store.session && store.session.captureCount === 0) {
          void discardStreetViewSession();
        } else {
          void endStreetViewSession();
        }
      }}
    />
  );

  const stopButton = (
    <Pressable
      onPress={handleStop}
      style={({ pressed }) => [styles.stopButton, { opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={dashRecording ? 'Stop dash cam recording' : 'Stop street imagery capture'}
      accessibilityHint={
        dashRecording
          ? 'Stops recording and keeps the footage already captured'
          : 'Stops capture and opens the upload summary'
      }
    >
      <Ionicons name="stop" size={16} color="#fff" />
    </Pressable>
  );

  if (!permission || !permission.granted) {
    return (
      <View
        style={[
          expanded ? styles.expandedPermissionPill : styles.permissionPill,
          expanded ? { height: bandHeight } : null,
        ]}
      >
        <Ionicons name="camera-outline" size={16} color="#fff" />
        <Text style={styles.permissionText}>{permission ? 'Camera off' : 'Starting camera…'}</Text>
        <Pressable onPress={handleStop} hitSlop={10} accessibilityLabel="Stop capture">
          <Ionicons name="close" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  }

  // One camera tree for both layouts: only the outer/inner styles change, so
  // switching tabs (expanded band ↔ compact pill) never remounts the camera
  // and never interrupts a dash-cam recording.
  return (
    <View
      style={expanded ? [styles.band, { height: bandHeight }] : styles.wrap}
      pointerEvents="box-none"
    >
      <View style={expanded ? styles.bandInner : styles.preview}>
        {camera}
        {expanded ? (
          <View
            style={[styles.bandOverlay, { paddingBottom: insets.bottom }]}
            pointerEvents="box-none"
          >
            <View style={styles.bandTopRow} pointerEvents="none">
              <View style={styles.recordingDot} />
              <Text style={styles.bandCounter}>
                {dashRecording ? formatClock(elapsed) : String(session?.captureCount ?? 0)}
              </Text>
              <Text style={styles.bandChip}>{dashRecording ? 'DASH CAM' : lensLabel}</Text>
              {dashRecording ? (
                <Text style={styles.bandHint}>{dashPaused ? 'Paused' : 'Recording'}</Text>
              ) : null}
            </View>
            <View style={styles.bandBottomRow} pointerEvents="box-none">
              {mountError ? (
                <Text style={styles.bandError}>Camera unavailable</Text>
              ) : (
                <Text style={styles.bandHint} numberOfLines={1}>
                  {dashRecording
                    ? 'Footage stays on this device'
                    : 'Street imagery · tap stop to review'}
                </Text>
              )}
              <View style={styles.bandStop}>{stopButton}</View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.topRow} pointerEvents="none">
              <View style={styles.recordingDot} />
              <Text style={styles.count}>
                {dashRecording ? formatClock(elapsed) : session?.captureCount}
              </Text>
              <Text style={styles.lens}>{dashRecording ? 'REC' : lensLabel}</Text>
            </View>
            {mountError ? (
              <View style={styles.errorOverlay} pointerEvents="none">
                <Text style={styles.errorText}>Camera unavailable</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
      {!expanded ? stopButton : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#111',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 30,
  },
  bandInner: {
    flex: 1,
  },
  bandOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  bandTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bandCounter: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
  bandChip: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  bandHint: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
  },
  bandError: {
    ...typography.caption,
    color: '#FFD60A',
    fontSize: 11,
  },
  bandBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bandStop: {
    marginBottom: spacing.xs,
  },
  wrap: {
    position: 'absolute',
    left: spacing.md,
    bottom: 190,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    zIndex: 20,
  },
  preview: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: '#111',
    borderCurve: 'continuous',
    zIndex: 20,
  },
  topRow: {
    position: 'absolute',
    top: 4,
    left: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  count: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 2,
  },
  lens: {
    marginLeft: 'auto',
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  errorText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 9,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  stopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,28,30,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  permissionPill: {
    position: 'absolute',
    left: spacing.md,
    bottom: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(28,28,30,0.9)',
    zIndex: 20,
  },
  expandedPermissionPill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(28,28,30,0.95)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    zIndex: 30,
  },
  permissionText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 12,
  },
});
