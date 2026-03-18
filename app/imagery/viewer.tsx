import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getImageryNearby } from '../../src/services/imagery/browseService';
import { ImageryViewer } from '../../src/components/imagery';
import { LoadingSpinner, ErrorBoundary } from '../../src/components/common';
import { colors, typography } from '../../src/constants/theme';
import type { StreetImagery } from '../../src/models/imagery';

export default function ImageryViewerScreen() {
  const { lat, lng, id } = useLocalSearchParams<{ lat?: string; lng?: string; id?: string }>();
  const router = useRouter();
  const [images, setImages] = useState<StreetImagery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (lat && lng) {
        const data = await getImageryNearby(parseFloat(lat), parseFloat(lng));
        setImages(data);
      }
      setLoading(false);
    })();
  }, [lat, lng]);

  const initialIndex = id ? images.findIndex((img) => img.id === id) : 0;

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  if (images.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No street imagery available here</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <ImageryViewer
        images={images}
        initialIndex={Math.max(0, initialIndex)}
        onClose={() => router.back()}
      />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
