import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildPanoramaHtml, DEFAULT_FOV_DEG } from './panoramaHtml';

export interface PanoramaViewerProps {
  /** Equirectangular (2:1) image URL. */
  imageUrl: string;
  /** Initial yaw in degrees (0 = north / image centre). */
  initialYaw?: number;
  /** Initial pitch in degrees. */
  initialPitch?: number;
  /** Initial vertical field of view in degrees. */
  initialFov?: number;
  onError?: (message: string) => void;
  testID?: string;
}

export function PanoramaViewer({
  imageUrl,
  initialYaw = 0,
  initialPitch = 0,
  initialFov = DEFAULT_FOV_DEG,
  onError,
  testID,
}: PanoramaViewerProps) {
  const html = useMemo(
    () => buildPanoramaHtml(imageUrl, initialYaw, initialPitch, initialFov),
    [imageUrl, initialYaw, initialPitch, initialFov],
  );

  return (
    <View style={styles.container} testID={testID}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        allowsInlineMediaPlayback
        onError={() => onError?.('Failed to load panorama')}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as { type?: string };
            if (data.type === 'fallback') onError?.('fallback');
          } catch {
            // Ignore non-JSON messages.
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  webview: { flex: 1, backgroundColor: '#000000' },
});
