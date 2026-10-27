import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  useVideoOutput,
  type CameraRef,
  type Recorder,
} from 'react-native-vision-camera';
import { createLocation } from 'react-native-vision-camera-location';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { dashCamElapsedSeconds, useDashCamStore } from '../../stores/dashCamStore';
import {
  captureConfigForMode,
  detailZoomForDevice,
  shouldCapture,
  shouldCaptureDetail,
  type LastCapture,
} from '../../services/imagery/streetViewCaptureLogic';
import { STREET_VIEW_DETAIL_EVERY_NTH, type StreetViewFix } from '../../models/streetViewCapture';
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
/** Let exposure and focus settle after the telephoto lens takes over. */
const DETAIL_ZOOM_SETTLE_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
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
 * Owns the single camera session used for on-drive capture: street-imagery
 * stills and the rolling dash-cam buffer.
 *
 * VisionCamera connects a photo output and a video output to the *same*
 * session, so a still can be taken while a dash-cam segment is recording.
 * (The previous expo-camera implementation bound either the photo output or
 * the movie output, which forced the two features to be mutually exclusive.)
 *
 * It is mounted only while something is capturing, but lives at the app root
 * so tab changes and the CarPlay companion screen cannot unmount the camera
 * mid-drive. Frames are triggered by raw GPS fixes from the navigation
 * pipeline, not a timer.
 *
 * The dash cam records in fixed-length segments; each finished segment lands in
 * the documents directory and the oldest segments are pruned once either
 * retention cap is exceeded.
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
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  // 3D mode asks for the ultra-wide lens; the filter falls back to the closest
  // match (the wide lens) when the device has no ultra-wide.
  const device = useCameraDevice(
    'back',
    mode === 'threeD' ? { physicalDevices: ['ultra-wide-angle'] } : undefined,
  );
  const config = captureConfigForMode(mode);
  const detailStreamEnabled = useSettingsStore((s) => s.streetView.detailStream);
  // Null on devices without a telephoto lens — zooming a wide-only camera
  // would just crop the frame the wide stream already has.
  const detailZoom = detailZoomForDevice(device);
  const photoOutput = usePhotoOutput({
    targetResolution: mode === 'standard' ? CommonResolutions.FHD_16_9 : CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: config.quality,
    qualityPrioritization: 'balanced',
  });
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    // No police-report audio: clips stay muted, which also avoids needing the
    // microphone permission.
    enableAudio: false,
  });

  const [ready, setReady] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [mountError, setMountError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const busyRef = useRef(false);
  const lastCaptureRef = useRef<LastCapture | null>(null);
  /** Wide frames this drive, for the detail-stream cadence. */
  const wideFrameCountRef = useRef(0);
  const permissionRequestedRef = useRef(false);
  const lastStorageCheckRef = useRef(0);
  const activeRef = useRef(appActive);
  const recorderRef = useRef<Recorder | null>(null);
  activeRef.current = appActive;

  const captureActive = Boolean(session) || dashRecording;
  // Only the navigation screen splits into "directions on top, live camera in
  // the bottom quarter"; every other screen keeps the compact pill so the map
  // and lists are not covered while a drive is running.
  const expanded = captureActive && Boolean(pathname?.includes('navigation'));
  const bandHeight = Math.max(BAND_MIN_HEIGHT, Math.round(windowHeight * BAND_SCREEN_FRACTION));
  const usingUltraWide =
    mode === 'threeD' &&
    Boolean(device?.physicalDevices?.some((entry) => entry.type === 'ultra-wide-angle'));
  const lensLabel = usingUltraWide ? '0.5×' : '1×';

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
    if (!captureActive || hasPermission || permissionRequestedRef.current) return;
    if (!canRequestPermission) {
      Alert.alert(
        'Camera access needed',
        'Enable camera access for Polaris Maps in the system Settings, then start again.',
      );
      useDashCamStore.getState().stop();
      void discardStreetViewSession();
      return;
    }
    permissionRequestedRef.current = true;
    void requestPermission().then((granted) => {
      if (granted) return;
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
  }, [captureActive, hasPermission, canRequestPermission, requestPermission]);

  /**
   * Captures the telephoto half of a pair from the same session.
   *
   * This runs *after* the wide frame, not concurrently: iOS gives one capture
   * session one active set of devices, and VisionCamera owns the session that
   * also feeds the preview and the dash cam. Opening a second
   * AVCaptureMultiCamSession would interrupt all three, so the two streams are
   * separated by a lens switch instead of by hardware concurrency.
   */
  const captureDetailFrame = useCallback(
    async (input: { driveId: string; fix: StreetViewFix; pairId: string; zoom: number }) => {
      const controller = cameraRef.current?.controller;
      if (!controller) return;
      try {
        await controller.setZoom(input.zoom);
        await delay(DETAIL_ZOOM_SETTLE_MS);
        const { filePath } = await photoOutput.capturePhotoToFile(
          {
            enableShutterSound: false,
            location: createLocation(input.fix.lat, input.fix.lng),
          },
          {},
        );
        if (!filePath) return;

        const source = toFileUri(filePath);
        const dir = await ensureStreetViewDriveDir(input.driveId);
        const id = Crypto.randomUUID();
        const dest = `${dir}${id}.jpg`;
        await FileSystem.moveAsync({ from: source, to: dest }).catch(async () => {
          await FileSystem.copyAsync({ from: source, to: dest });
          await FileSystem.deleteAsync(source, { idempotent: true }).catch(() => {});
        });
        const [bytes, size] = await Promise.all([getLocalFileSize(dest), getImageSize(dest)]);

        await insertCapture({
          id,
          driveId: input.driveId,
          localUri: dest,
          lat: input.fix.lat,
          lng: input.fix.lng,
          altitude: input.fix.altitude,
          heading: input.fix.heading,
          speedMps: input.fix.speedMps,
          capturedAt: Date.now(),
          width: size.width,
          height: size.height,
          bytes,
          stream: 'detail',
          pairId: input.pairId,
        });
        recordCapture(bytes);
      } catch (error) {
        // A missed detail frame must never abort the wide stream.
        setSessionError(error instanceof Error ? error.message : String(error));
      } finally {
        await controller.setZoom(1).catch(() => {});
      }
    },
    [photoOutput, recordCapture, setSessionError],
  );

  const takePicture = useCallback(async () => {
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
    if (!decision.capture) return;

    busyRef.current = true;
    try {
      const capturedAt = Date.now();
      // The photo output is separate from the video output, so this still
      // works while a dash-cam segment is recording.
      const { filePath } = await photoOutput.capturePhotoToFile(
        {
          enableShutterSound: false,
          // VisionCamera embeds this as GPS EXIF (lat/lng/time).
          location: createLocation(fix.lat, fix.lng),
        },
        {},
      );
      if (!filePath) return;

      const source = toFileUri(filePath);
      const dir = await ensureStreetViewDriveDir(currentSession.driveId);
      const id = Crypto.randomUUID();
      const dest = `${dir}${id}.jpg`;
      await FileSystem.moveAsync({ from: source, to: dest }).catch(async () => {
        await FileSystem.copyAsync({ from: source, to: dest });
        await FileSystem.deleteAsync(source, { idempotent: true }).catch(() => {});
      });
      const [bytes, size] = await Promise.all([getLocalFileSize(dest), getImageSize(dest)]);

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
        width: size.width,
        height: size.height,
        bytes,
      });

      lastCaptureRef.current = { lat: fix.lat, lng: fix.lng, capturedAt };
      recordCapture(bytes);

      wideFrameCountRef.current += 1;
      const detail = shouldCaptureDetail({
        enabled: detailStreamEnabled,
        detailZoom,
        everyNth: STREET_VIEW_DETAIL_EVERY_NTH,
        wideFrameCount: wideFrameCountRef.current,
        dashCamRecording: useDashCamStore.getState().recording,
      });
      if (detail.capture && detailZoom != null) {
        await captureDetailFrame({
          driveId: currentSession.driveId,
          fix,
          pairId: id,
          zoom: detailZoom,
        });
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
    }
  }, [
    captureDetailFrame,
    config,
    detailStreamEnabled,
    detailZoom,
    photoOutput,
    ready,
    recordCapture,
    setSessionError,
  ]);

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

  /** Records one segment straight into the documents directory. */
  const recordSegment = useCallback(
    async (startedAt: number): Promise<{ uri: string; durationMs: number } | null> => {
      const dir = await ensureDashCamDir();
      const destPath = `${dir}${Crypto.randomUUID()}.mp4`;
      const fix = useNavigationTrackingStore.getState().rawFix;
      const recorder = await videoOutput.createRecorder({
        maxDuration: clipSeconds,
        filePath: destPath,
        location: fix ? createLocation(fix.lat, fix.lng) : undefined,
      });
      recorderRef.current = recorder;
      try {
        let settle: (path: string) => void = () => {};
        let fail: (error: unknown) => void = () => {};
        const finished = new Promise<string>((resolve, reject) => {
          settle = resolve;
          fail = reject;
        });
        await recorder.startRecording(settle, fail);
        const path = await finished;
        return { uri: toFileUri(path || destPath), durationMs: Date.now() - startedAt };
      } finally {
        recorderRef.current = null;
      }
    },
    [clipSeconds, videoOutput],
  );

  /** Saves one finished segment and enforces the rolling retention caps. */
  const persistClip = useCallback(
    async (clip: { uri: string; durationMs: number }, startedAt: number) => {
      const info = await FileSystem.getInfoAsync(clip.uri);
      const bytes = info.exists && typeof info.size === 'number' ? info.size : 0;
      await insertDashCamClip({
        id: Crypto.randomUUID(),
        localUri: clip.uri,
        startedAt,
        durationMs: clip.durationMs,
        bytes,
        createdAt: Date.now(),
      });
      recordClip(bytes);
      const { maxMinutes, maxBytes } = useSettingsStore.getState().dashCam;
      await pruneDashCamClips({ maxMinutes, maxBytes });
    },
    [recordClip],
  );

  // Segmented loop recorder. Each segment stops at `clipSeconds`, so the buffer
  // is a series of files rather than one unbounded recording. The loop pauses
  // while the app is not active (the camera session stops when the phone locks)
  // and resumes at the next segment.
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
        let clip: { uri: string; durationMs: number } | null = null;
        try {
          clip = await recordSegment(startedAt);
        } catch (error) {
          setDashCamError(error instanceof Error ? error.message : String(error));
          await delay(1000);
          continue;
        }
        if (!clip) {
          await delay(500);
          continue;
        }

        try {
          await persistClip(clip, startedAt);
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
      void recorderRef.current?.stopRecording().catch(() => {});
      setDashCamPaused(false);
    };
  }, [dashRecording, ready, recordSegment, persistClip, setDashCamError, setDashCamPaused]);

  if (!session && !dashRecording) return null;

  const stopStreetView = () => {
    void endStreetViewSession();
  };
  const stopDashCam = () => {
    useDashCamStore.getState().stop();
    void recorderRef.current?.stopRecording().catch(() => {});
  };

  const stopButton = (kind: 'streetview' | 'dashcam') => (
    <Pressable
      onPress={kind === 'dashcam' ? stopDashCam : stopStreetView}
      style={({ pressed }) => [styles.stopButton, { opacity: pressed ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={
        kind === 'dashcam' ? 'Stop dash cam recording' : 'Stop street imagery capture'
      }
      accessibilityHint={
        kind === 'dashcam'
          ? 'Stops recording and keeps the footage already captured'
          : 'Stops capture and opens the upload summary'
      }
    >
      <Ionicons name={kind === 'dashcam' ? 'videocam-off' : 'stop'} size={16} color="#fff" />
    </Pressable>
  );

  const stopControls = (
    <View style={styles.stopRow}>
      {session ? stopButton('streetview') : null}
      {dashRecording ? stopButton('dashcam') : null}
    </View>
  );

  if (!hasPermission) {
    return (
      <View
        style={[
          expanded ? styles.expandedPermissionPill : styles.permissionPill,
          expanded ? { height: bandHeight } : null,
        ]}
      >
        <Ionicons name="camera-outline" size={16} color="#fff" />
        <Text style={styles.permissionText}>Camera off</Text>
        <Pressable onPress={stopStreetView} hitSlop={10} accessibilityLabel="Stop capture">
          <Ionicons name="close" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  }

  // One camera tree for both layouts: only the outer/inner styles change, so
  // switching tabs (expanded band ↔ compact pill) never remounts the camera
  // and never interrupts a recording.
  return (
    <View
      style={expanded ? [styles.band, { height: bandHeight }] : styles.wrap}
      pointerEvents="box-none"
    >
      <View style={expanded ? styles.bandInner : styles.preview}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          isActive={appActive}
          device={device ?? 'back'}
          outputs={[photoOutput, videoOutput]}
          resizeMode="cover"
          onStarted={() => {
            setReady(true);
            setMountError(null);
          }}
          onStopped={() => setReady(false)}
          onError={(error) => {
            setMountError(error.message);
            Alert.alert(
              'Camera unavailable',
              error.message || 'The camera could not start. Stop other camera apps and try again.',
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
        {expanded ? (
          <View
            style={[styles.bandOverlay, { paddingBottom: insets.bottom }]}
            pointerEvents="box-none"
          >
            <View style={styles.bandTopRow} pointerEvents="none">
              {dashRecording || session ? <View style={styles.recordingDot} /> : null}
              {dashRecording ? (
                <Text style={styles.bandCounter}>{formatClock(elapsed)}</Text>
              ) : null}
              {session ? <Text style={styles.bandCounter}>{session.captureCount}</Text> : null}
              <Text style={styles.bandChip}>
                {dashRecording && session
                  ? 'DASH CAM + PHOTOS'
                  : dashRecording
                    ? 'DASH CAM'
                    : lensLabel}
              </Text>
              {dashRecording ? (
                <Text style={styles.bandHint}>{dashPaused ? 'Paused' : 'Recording'}</Text>
              ) : null}
            </View>
            <View style={styles.bandBottomRow} pointerEvents="box-none">
              {mountError ? (
                <Text style={styles.bandError}>Camera unavailable</Text>
              ) : (
                <Text style={styles.bandHint} numberOfLines={1}>
                  {dashRecording && session
                    ? 'Footage stays on this device · photos upload later'
                    : dashRecording
                      ? 'Footage stays on this device'
                      : 'Street imagery · tap stop to review'}
                </Text>
              )}
              <View style={styles.bandStop}>{stopControls}</View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.topRow} pointerEvents="none">
              <View style={styles.recordingDot} />
              <Text style={styles.count}>
                {dashRecording ? formatClock(elapsed) : session?.captureCount}
              </Text>
              <Text style={styles.lens}>
                {dashRecording && session ? 'REC+IMG' : dashRecording ? 'REC' : lensLabel}
              </Text>
            </View>
            {mountError ? (
              <View style={styles.errorOverlay} pointerEvents="none">
                <Text style={styles.errorText}>Camera unavailable</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
      {!expanded ? stopControls : null}
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
    gap: 8,
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
  stopRow: {
    flexDirection: 'row',
    gap: 6,
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
