import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography } from '../../constants/theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
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

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 54;

/**
 * Owns the single CameraView used for street-imagery capture.
 *
 * It is mounted only while a capture session is active, but lives at the app
 * root so tab changes and the CarPlay companion screen cannot unmount the
 * camera mid-drive. Frames are triggered by raw GPS fixes from the navigation
 * pipeline, not a timer.
 */
export function CaptureHost() {
  const session = useStreetViewCaptureStore((s) => s.session);
  const recordCapture = useStreetViewCaptureStore((s) => s.recordCapture);
  const setSessionError = useStreetViewCaptureStore((s) => s.setSessionError);
  const mode = useSettingsStore((s) => s.streetView.mode);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [selectedLens, setSelectedLens] = useState<string | null>(null);
  const [pictureSize, setPictureSize] = useState<string | null>(null);
  const [lensLabel, setLensLabel] = useState(mode === 'threeD' ? '3D' : '1×');
  const [mountError, setMountError] = useState<string | null>(null);

  const busyRef = useRef(false);
  const lastCaptureRef = useRef<LastCapture | null>(null);
  const resolvedModeRef = useRef<string | null>(null);
  const permissionRequestedRef = useRef(false);
  const lastStorageCheckRef = useRef(0);
  const activeRef = useRef(appActive);
  activeRef.current = appActive;

  const config = captureConfigForMode(mode);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  // Ask for camera permission once. A denial ends the drive cleanly instead of
  // leaving an empty queue entry behind.
  useEffect(() => {
    if (!permission || permission.granted || permissionRequestedRef.current) return;
    permissionRequestedRef.current = true;
    void requestPermission().then((result) => {
      if (result.granted) return;
      Alert.alert(
        'Camera access needed',
        'Street imagery capture needs camera access. You can enable it later in Settings.',
      );
      // Do not immediately retry on the next drive; the OS will not prompt
      // again until the user changes the permission in Settings.
      useSettingsStore.getState().setStreetView({ autoStart: false });
      void discardStreetViewSession();
    });
  }, [permission, requestPermission]);

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
      if (free != null && free < 500 * 1024 * 1024) {
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

  if (!session) return null;

  const handleStop = () => {
    void endStreetViewSession();
  };

  if (!permission || !permission.granted) {
    return (
      <View style={styles.permissionPill}>
        <Ionicons name="camera-outline" size={16} color="#fff" />
        <Text style={styles.permissionText}>{permission ? 'Camera off' : 'Starting camera…'}</Text>
        <Pressable onPress={handleStop} hitSlop={10} accessibilityLabel="Stop street imagery">
          <Ionicons name="close" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.preview}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          active={appActive}
          animateShutter={false}
          responsiveOrientationWhenOrientationLocked
          selectedLens={selectedLens ?? undefined}
          pictureSize={pictureSize ?? undefined}
          onCameraReady={onCameraReady}
          onMountError={(event) => {
            setMountError(event.message);
            Alert.alert(
              'Camera unavailable',
              event.message || 'The camera could not start. Stop other camera apps and try again.',
            );
            const store = useStreetViewCaptureStore.getState();
            if (store.session && store.session.captureCount === 0) {
              void discardStreetViewSession();
            } else {
              void endStreetViewSession();
            }
          }}
        />
        <View style={styles.topRow} pointerEvents="none">
          <View style={styles.recordingDot} />
          <Text style={styles.count}>{session.captureCount}</Text>
          <Text style={styles.lens}>{lensLabel}</Text>
        </View>
        {mountError ? (
          <View style={styles.errorOverlay} pointerEvents="none">
            <Text style={styles.errorText}>Camera unavailable</Text>
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={handleStop}
        style={({ pressed }) => [styles.stopButton, { opacity: pressed ? 0.8 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Stop street imagery capture"
        accessibilityHint="Stops capture and opens the upload summary"
      >
        <Ionicons name="stop" size={16} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
    width: 30,
    height: 30,
    borderRadius: 15,
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
  permissionText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 12,
  },
});
