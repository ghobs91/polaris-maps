import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import {
  initCaptureDir,
  captureImage,
  getCaptureCount,
  startIntervalCapture,
  stopIntervalCapture,
} from '../../src/services/imagery/captureService';
import { uploadImage } from '../../src/services/imagery/uploadService';
import { Button, ErrorBoundary } from '../../src/components/common';
import { colors, spacing, typography, borderRadius } from '../../src/constants/theme';

const CAPTURE_INTERVAL_MS = 5000;

export default function CaptureScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [queueSize, setQueueSize] = useState(0);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    if (!photo) return;

    setQueueSize((q) => q + 1);

    try {
      const result = await captureImage(photo.uri, photo.width, photo.height);
      await uploadImage(result.localUri, result.metadata);
      setUploadCount((c) => c + 1);
    } catch {
      // Keep in queue for retry
    } finally {
      setQueueSize((q) => Math.max(0, q - 1));
    }
  }, []);

  const toggleCapture = useCallback(async () => {
    if (capturing) {
      stopIntervalCapture();
      setCapturing(false);
    } else {
      await initCaptureDir();
      setCapturing(true);
      // Start interval capture — each tick triggers handleCapture via timer
      const timer = setInterval(() => {
        handleCapture();
      }, CAPTURE_INTERVAL_MS);
      // Store cleanup
      return () => clearInterval(timer);
    }
  }, [capturing, handleCapture]);

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>
          Camera access is required to capture street imagery
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} variant="primary" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />

        <View style={styles.overlay}>
          <View style={styles.stats}>
            <Text style={styles.statText}>Uploaded: {uploadCount}</Text>
            <Text style={styles.statText}>Queue: {queueSize}</Text>
          </View>

          <View style={styles.controls}>
            <Pressable
              style={[styles.captureBtn, capturing && styles.captureBtnActive]}
              onPress={toggleCapture}
              accessibilityLabel={capturing ? 'Stop capture' : 'Start capture'}
            >
              <View style={[styles.captureBtnInner, capturing && styles.captureBtnInnerActive]} />
            </Pressable>
          </View>

          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  permissionText: {
    ...typography.body,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.lg },
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  statText: { color: '#FFF', ...typography.caption },
  controls: { alignItems: 'center', marginBottom: spacing.md },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnActive: { borderColor: colors.error },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF' },
  captureBtnInnerActive: { borderRadius: 8, width: 32, height: 32, backgroundColor: colors.error },
  closeBtn: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  closeBtnText: { color: '#FFF', ...typography.body, fontWeight: '600' },
});
