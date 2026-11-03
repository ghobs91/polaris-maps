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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  useVideoOutput,
  VisionCamera,
  type CameraRef,
  type OrientationManager,
  type Recorder,
} from 'react-native-vision-camera';
import { createLocation } from 'react-native-vision-camera-location';
import { captureBandHeight } from './captureBand';
import {
  CAPTURE_SPLIT_LEFT_PERCENT,
  CAPTURE_ZOOM_PRESETS,
  clampCaptureZoom,
  nextCaptureZoom,
  shouldUseSplitCapture,
} from './captureLayout';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { dashCamElapsedSeconds, useDashCamStore } from '../../stores/dashCamStore';
import {
  captureConfigForMode,
  detailZoomForDevice,
  isPortraitOrientation,
  resolveCaptureMode,
  shouldCapture,
  shouldCaptureDetail,
  shouldLockInfinityFocus,
  type CaptureOrientation,
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

/**
 * Device orientation with a fallback for hardware that has no accelerometer
 * (notably the iOS Simulator, where VisionCamera's `useOrientation` throws).
 * An unknown orientation never blocks capture; the upload-time portrait check
 * remains the final safety net.
 */
function useCaptureOrientation(enabled: boolean): CaptureOrientation | undefined {
  const [orientation, setOrientation] = useState<CaptureOrientation | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setOrientation(undefined);
      return;
    }

    let manager: OrientationManager;
    try {
      manager = VisionCamera.createOrientationManager('device');
      setOrientation(manager.currentOrientation);
      manager.startOrientationUpdates(setOrientation);
    } catch {
      // No accelerometer: leave the orientation unknown.
      setOrientation(undefined);
      return;
    }

    return () => {
      try {
        manager.stopOrientationUpdates();
      } catch {
        // Already stopped.
      }
    };
  }, [enabled]);

  return orientation;
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
  const dashRecording = useDashCamStore((s) => s.recording);
  const dashPaused = useDashCamStore((s) => s.paused);
  const recordClip = useDashCamStore((s) => s.recordClip);
  const setDashCamPaused = useDashCamStore((s) => s.setPaused);
  const setDashCamError = useDashCamStore((s) => s.setError);
  const clipSeconds = useSettingsStore((s) => s.dashCam.clipSeconds);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const detailStreamEnabled = useSettingsStore((s) => s.streetView.detailStream);
  const zoom = clampCaptureZoom(useSettingsStore((s) => s.streetView.zoom));
  const setStreetView = useSettingsStore((s) => s.setStreetView);
  const backDevice = useCameraDevice('back');
  // The filter returns the closest match, so inspect the device it yields for a
  // real ultra-wide lens rather than trusting the filter alone.
  const ultraWideDevice = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle'] });
  const hasUltraWide = Boolean(
    ultraWideDevice?.physicalDevices?.some((entry) => entry.type === 'ultra-wide-angle'),
  );
  // Capture quality is chosen for the device; there is no user-facing mode.
  const mode = resolveCaptureMode({ hasUltraWide, detailStream: detailStreamEnabled });
  const device = mode === 'threeD' ? ultraWideDevice : backDevice;
  const config = captureConfigForMode(mode);
  // Null on devices without a telephoto lens — zooming a wide-only camera
  // would just crop the frame the wide stream already has.
  const detailZoom = detailZoomForDevice(backDevice);
  // A user crop at or past the telephoto switch already gives the detail
  // stream's field of view; the paired frame would add nothing.
  const effectiveDetailZoom = detailZoom != null && zoom >= detailZoom ? null : detailZoom;
  const photoOutput = usePhotoOutput({
    // Mapillary's app captures 4:3 full-sensor stills. A 16:9 crop loses
    // detail at the edges and moves the aspect ratio towards 2:1, which
    // Mapillary treats as an equirectangular panorama.
    targetResolution: CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: config.quality,
    // Prefer a shorter capture over a lower-noise one: the camera is moving,
    // so a slow shutter turns the road into light trails (especially at night).
    qualityPrioritization: device?.supportsSpeedQualityPrioritization ? 'speed' : 'balanced',
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
  /** True while the lens is locked at infinity for high-speed capture. */
  const focusLockedRef = useRef(false);
  const permissionRequestedRef = useRef(false);
  const lastStorageCheckRef = useRef(0);
  const activeRef = useRef(appActive);
  const recorderRef = useRef<Recorder | null>(null);
  activeRef.current = appActive;

  // Mapillary only accepts landscape imagery; keep the navigation UI as-is but
  // stop taking stills while the phone is portrait, exactly like their app.
  // Only listen to the accelerometer while a capture is actually running.
  const captureActive = Boolean(session) || dashRecording;
  const deviceOrientation = useCaptureOrientation(session != null);
  const portrait = isPortraitOrientation(deviceOrientation);
  const onNavigation = Boolean(pathname?.includes('navigation'));
  // Landscape navigation with a live capture: the camera becomes the right 70%
  // pane and the navigation screen renders the directions feed on the left.
  const splitCapture =
    onNavigation &&
    shouldUseSplitCapture({
      width: windowWidth,
      height: windowHeight,
      capturing: captureActive,
    });

  // Only the navigation screen splits into "directions + camera"; every other
  // screen keeps the compact pill so the map and lists are not covered.
  const expanded = captureActive && onNavigation && !splitCapture;
  const bandHeight = captureBandHeight(windowHeight);
  const zoomLabel = `${Number.isInteger(zoom) ? zoom.toFixed(0) : zoom.toFixed(1)}×`;
  const setCaptureZoom = (value: number) => setStreetView({ zoom: clampCaptureZoom(value) });
  const zoomChips = (
    <View style={styles.zoomRow}>
      {CAPTURE_ZOOM_PRESETS.map((preset) => {
        const active = preset === zoom;
        return (
          <Pressable
            key={preset}
            onPress={() => setCaptureZoom(preset)}
            style={({ pressed }) => [
              styles.zoomChip,
              active && styles.zoomChipActive,
              { opacity: pressed ? 0.75 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Set camera zoom to ${preset} times`}
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.zoomChipText, active && styles.zoomChipTextActive]}>
              {Number.isInteger(preset) ? preset.toFixed(0) : preset.toFixed(1)}×
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  const zoomCycleChip = (
    <Pressable
      onPress={() => setCaptureZoom(nextCaptureZoom(zoom))}
      style={({ pressed }) => [styles.zoomCycleChip, { opacity: pressed ? 0.75 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Camera zoom ${zoom} times`}
      accessibilityHint="Cycles through 1, 1.5, 2 and 3 times zoom"
    >
      <Text style={styles.zoomCycleText}>{zoomLabel}</Text>
    </Pressable>
  );

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
   * Match Mapillary's focus policy: lock the lens at infinity once the vehicle
   * is moving faster than 10 mph, and hand control back to continuous
   * autofocus when it slows down. Best-effort — a focus failure must never
   * cost a frame.
   */
  const syncInfinityFocus = useCallback(async (speedMps: number, force = false) => {
    const controller = cameraRef.current?.controller;
    if (!controller) return;
    // Capture is a road-facing task: hold infinity for the whole session, not
    // only above 10 mph. Otherwise a stop lets AF settle on the dashboard.
    const capturing =
      useStreetViewCaptureStore.getState().session != null || useDashCamStore.getState().recording;
    const lock = capturing || shouldLockInfinityFocus(speedMps);
    if (!force && lock === focusLockedRef.current) return;
    try {
      if (lock) {
        if (controller.device.supportsFocusLocking) {
          await controller.setFocusLocked(1);
        } else if (controller.device.supportsFocusMetering) {
          // Android has no lens-position lock. Meter a point above center (the
          // road) and hold it instead of letting AF settle on the dash.
          const point = VisionCamera.createNormalizedMeteringPoint(0.5, 0.35);
          await controller.focusTo(point, {
            modes: ['AF'],
            responsiveness: 'snappy',
            adaptiveness: 'locked',
          });
        } else {
          return;
        }
      } else if (focusLockedRef.current) {
        await controller.resetFocus();
      }
      focusLockedRef.current = lock;
    } catch {
      // Leave the previous state; the next fix retries.
    }
  }, []);

  // Apply the user's crop to the preview and to both the still and video
  // outputs. A zoom change can reset focus, so re-assert the infinity lock.
  useEffect(() => {
    if (!ready) return;
    const controller = cameraRef.current?.controller;
    if (!controller) return;
    void controller.setZoom(zoom).catch(() => {});
    void syncInfinityFocus(0, true);
  }, [device?.id, ready, syncInfinityFocus, zoom]);

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
        // Switching to the telephoto constituent resets focus, so re-apply the
        // infinity lock to the lens that will actually take this frame.
        await syncInfinityFocus(input.fix.speedMps, true);
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
        await controller.setZoom(zoom).catch(() => {});
        // Returning to the wide lens resets focus; restore the infinity lock.
        if (focusLockedRef.current) {
          await syncInfinityFocus(input.fix.speedMps, true);
        }
      }
    },
    [photoOutput, recordCapture, setSessionError, syncInfinityFocus, zoom],
  );

  const takePicture = useCallback(async () => {
    if (!ready || busyRef.current || !activeRef.current) return;
    const currentSession = useStreetViewCaptureStore.getState().session;
    if (!currentSession) return;
    // Mapillary rejects portrait imagery; the band shows a rotate hint while
    // this is true, so no frames are queued for a drive that cannot upload.
    if (portrait) return;

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
        detailZoom: effectiveDetailZoom,
        everyNth: STREET_VIEW_DETAIL_EVERY_NTH,
        wideFrameCount: wideFrameCountRef.current,
        dashCamRecording: useDashCamStore.getState().recording,
      });
      if (detail.capture && effectiveDetailZoom != null) {
        await captureDetailFrame({
          driveId: currentSession.driveId,
          fix,
          pairId: id,
          zoom: effectiveDetailZoom,
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
    effectiveDetailZoom,
    photoOutput,
    portrait,
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
    // Re-evaluate focus on every fix, even when no frame is due: slowing below
    // 10 mph must hand focus back to autofocus so the dash cam stays sharp.
    void (async () => {
      await syncInfinityFocus(rawFix.speedMps);
      await takePicture();
    })();
  }, [rawFix, syncInfinityFocus, takePicture]);

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

  const modePills = (
    <>
      <View style={[styles.modePill, session && styles.modePillActive]}>
        <MaterialCommunityIcons
          name="camera-marker"
          size={13}
          color={session ? (portrait ? '#FFD60A' : '#fff') : 'rgba(255,255,255,0.5)'}
        />
        <Text style={[styles.modePillLabel, !session && styles.modePillLabelMuted]}>
          Street imagery
        </Text>
        <Text style={styles.modePillValue}>
          {session ? (portrait ? 'Rotate' : session.captureCount) : 'Off'}
        </Text>
      </View>
      <View style={[styles.modePill, dashRecording && styles.modePillActive]}>
        <Ionicons
          name="videocam"
          size={13}
          color={dashRecording ? '#FF453A' : 'rgba(255,255,255,0.5)'}
        />
        <Text style={[styles.modePillLabel, !dashRecording && styles.modePillLabelMuted]}>
          Dash cam
        </Text>
        <Text style={styles.modePillValue}>
          {dashRecording ? (dashPaused ? 'Paused' : formatClock(elapsed)) : 'Off'}
        </Text>
      </View>
    </>
  );

  const modeControls = (
    <View style={styles.modeControlRow}>
      {session ? (
        <Pressable
          onPress={stopStreetView}
          style={({ pressed }) => [styles.modeControl, { opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Stop street imagery capture"
          accessibilityHint="Stops capture and opens the upload summary"
        >
          <MaterialCommunityIcons name="camera-marker" size={16} color="#FF453A" />
          <Text style={styles.modeControlText}>Stop street</Text>
        </Pressable>
      ) : null}
      {dashRecording ? (
        <Pressable
          onPress={stopDashCam}
          style={({ pressed }) => [styles.modeControl, { opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Stop dash cam recording"
          accessibilityHint="Stops recording and keeps the footage already captured"
        >
          <Ionicons name="videocam" size={16} color="#FF453A" />
          <Text style={styles.modeControlText}>Stop dash</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const compactModeControls = (
    <View style={styles.stopRow}>
      {session ? (
        <Pressable
          onPress={stopStreetView}
          style={({ pressed }) => [styles.stopButton, { opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Stop street imagery capture"
        >
          <MaterialCommunityIcons name="camera-marker" size={18} color="#FF453A" />
        </Pressable>
      ) : null}
      {dashRecording ? (
        <Pressable
          onPress={stopDashCam}
          style={({ pressed }) => [styles.stopButton, { opacity: pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Stop dash cam recording"
        >
          <Ionicons name="videocam" size={18} color="#FF453A" />
        </Pressable>
      ) : null}
    </View>
  );

  const bandHintText =
    dashRecording && session
      ? 'Dash cam stays on this device · street photos upload later'
      : dashRecording
        ? 'Dash cam stays on this device'
        : 'Street imagery uploads to Mapillary';

  const rotateOverlay = (
    <View style={styles.rotateOverlay} accessibilityRole="alert">
      <View style={styles.rotateCard}>
        <View style={styles.rotateIconWrap}>
          <Ionicons name="phone-landscape-outline" size={28} color="#FFD60A" />
        </View>
        <View style={styles.rotateText}>
          <Text style={styles.rotateTitle}>Rotate to landscape</Text>
          <Text style={styles.rotateBody}>
            Street imagery needs a sideways camera. Turn your phone to start capturing.
          </Text>
          {dashRecording ? <Text style={styles.rotateSub}>Dash cam keeps recording.</Text> : null}
          <View style={styles.rotateActions}>
            <Pressable
              onPress={stopStreetView}
              style={({ pressed }) => [styles.rotateAction, { opacity: pressed ? 0.8 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Stop street imagery capture"
            >
              <MaterialCommunityIcons name="camera-marker" size={14} color="#fff" />
              <Text style={styles.rotateActionText}>Stop street imagery</Text>
            </Pressable>
            {dashRecording ? (
              <Pressable
                onPress={stopDashCam}
                style={({ pressed }) => [styles.rotateAction, { opacity: pressed ? 0.8 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Stop dash cam recording"
              >
                <Ionicons name="videocam" size={14} color="#fff" />
                <Text style={styles.rotateActionText}>Stop dash cam</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );

  if (!hasPermission) {
    return (
      <View
        style={[
          splitCapture
            ? styles.splitPermission
            : expanded
              ? styles.expandedPermissionPill
              : styles.permissionPill,
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

  // One camera tree for every layout: only the outer/inner styles change, so
  // switching between the compact pill, the portrait band, and the landscape
  // pane never remounts the camera or interrupts a recording.
  return (
    <View
      style={
        splitCapture
          ? styles.splitPane
          : expanded
            ? [styles.band, { height: bandHeight }]
            : styles.wrap
      }
      pointerEvents="box-none"
    >
      <View style={splitCapture ? styles.splitInner : expanded ? styles.bandInner : styles.preview}>
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
          onStopped={() => {
            setReady(false);
            // A new session starts with autofocus until the next fix re-locks.
            focusLockedRef.current = false;
          }}
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
        {splitCapture ? (
          <View
            style={[
              styles.splitOverlay,
              {
                paddingTop: insets.top + spacing.sm,
                paddingRight: insets.right + spacing.md,
                paddingBottom: insets.bottom + spacing.md,
                paddingLeft: spacing.md,
              },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.splitTopRow} pointerEvents="box-none">
              {modePills}
              <View style={styles.flexSpacer} />
              {zoomChips}
            </View>
            <View style={styles.splitBottomRow} pointerEvents="box-none">
              {mountError ? (
                <Text style={styles.bandError}>Camera unavailable</Text>
              ) : (
                <Text style={styles.splitHint} numberOfLines={2}>
                  {bandHintText}
                </Text>
              )}
              <View style={styles.bandStop}>{modeControls}</View>
            </View>
          </View>
        ) : expanded ? (
          <View
            style={[styles.bandOverlay, { paddingBottom: insets.bottom }]}
            pointerEvents="box-none"
          >
            <View style={styles.bandTopRow} pointerEvents="box-none">
              {modePills}
              <View style={styles.flexSpacer} />
              {zoomCycleChip}
            </View>
            <View style={styles.bandBottomRow} pointerEvents="box-none">
              {mountError ? (
                <Text style={styles.bandError}>Camera unavailable</Text>
              ) : (
                <Text style={styles.bandHint} numberOfLines={1}>
                  {bandHintText}
                </Text>
              )}
              <View style={styles.bandStop}>{modeControls}</View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.topRow} pointerEvents="none">
              <View style={styles.recordingDot} />
              {dashRecording ? (
                <>
                  <Ionicons name="videocam" size={9} color="#fff" />
                  <Text style={styles.count}>{formatClock(elapsed)}</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="camera-marker" size={9} color="#fff" />
                  <Text style={styles.count}>{session?.captureCount ?? ''}</Text>
                </>
              )}
              <Text style={styles.lens}>{zoomLabel}</Text>
            </View>
            {mountError ? (
              <View style={styles.errorOverlay} pointerEvents="none">
                <Text style={styles.errorText}>Camera unavailable</Text>
              </View>
            ) : null}
          </>
        )}
        {expanded && session && portrait ? rotateOverlay : null}
      </View>
      {!expanded && !splitCapture ? compactModeControls : null}
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
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  zoomChip: {
    minWidth: 34,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  zoomChipActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  zoomChipText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  zoomChipTextActive: {
    color: '#000',
  },
  zoomCycleChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  zoomCycleText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  bandHint: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    flexShrink: 1,
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
  splitPane: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: CAPTURE_SPLIT_LEFT_PERCENT,
    backgroundColor: '#000',
    zIndex: 30,
  },
  splitInner: { flex: 1 },
  splitOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  splitTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  splitBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  splitHint: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    flex: 1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
  splitPermission: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: CAPTURE_SPLIT_LEFT_PERCENT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(28,28,30,0.95)',
    zIndex: 30,
  },
  flexSpacer: { flex: 1 },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    flexShrink: 1,
  },
  modePillActive: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderColor: 'rgba(255,255,255,0.5)',
  },
  modePillLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  modePillLabelMuted: {
    color: 'rgba(255,255,255,0.55)',
  },
  modePillValue: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  modeControlRow: {
    flexDirection: 'row',
    gap: 6,
  },
  modeControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'rgba(28,28,30,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  modeControlText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  rotateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.84)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    zIndex: 40,
  },
  rotateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 380,
  },
  rotateIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,214,10,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.55)',
    flexShrink: 0,
  },
  rotateText: { flexShrink: 1 },
  rotateTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  rotateBody: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  rotateSub: {
    color: '#FFD60A',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  rotateActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  rotateAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  rotateActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
