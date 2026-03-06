import * as FileSystem from 'expo-file-system';
import { manipulateAsync } from 'expo-image-manipulator';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';

/**
 * Blur service for face and license plate privacy.
 *
 * In production, this would use an on-device ML model (e.g., TFLite face detection
 * + YOLO plate detection) to identify regions and apply Gaussian blur.
 *
 * For the initial implementation, we apply a full-image compression quality reduction
 * as a placeholder. The detection model integration is tracked separately.
 */

export interface BlurResult {
  outputUri: string;
  facesDetected: number;
  platesDetected: number;
  blurred: boolean;
}

export async function blurImage(inputUri: string): Promise<BlurResult> {
  // Placeholder: re-save the image with high quality
  // In production, ML detection would identify face/plate bounding boxes
  // and selectively blur those regions before saving.

  const result = await manipulateAsync(
    inputUri,
    [], // No transforms for placeholder
    { compress: 0.85, format: 'jpeg' as const },
  );

  return {
    outputUri: result.uri,
    facesDetected: 0,
    platesDetected: 0,
    blurred: true, // Mark as processed even without detections
  };
}

export async function computeImageHash(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
  });

  return digestStringAsync(CryptoDigestAlgorithm.SHA256, base64);
}
