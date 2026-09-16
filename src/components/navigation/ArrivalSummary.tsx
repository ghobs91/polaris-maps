import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistance, formatDuration } from '../../utils/units';

interface ArrivalSummaryProps {
  destinationName?: string;
  /** Elapsed navigation time in seconds. */
  elapsedSeconds: number;
  /** Total route distance in metres. */
  distanceMeters: number;
  onDismiss: () => void;
}

/** Non-blocking arrival card shown when the destination is reached. */
export function ArrivalSummary({
  destinationName,
  elapsedSeconds,
  distanceMeters,
  onDismiss,
}: ArrivalSummaryProps) {
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.card} accessibilityRole="summary">
        <Ionicons name="checkmark-circle" size={44} color="#34C759" />
        <Text style={styles.title}>You have arrived</Text>
        {destinationName ? (
          <Text style={styles.destination} numberOfLines={1}>
            {destinationName}
          </Text>
        ) : null}
        <View style={styles.statsRow}>
          <Text style={styles.stat}>{formatDuration(elapsedSeconds)}</Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.stat}>{formatDistance(distanceMeters)}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="End navigation"
        >
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    width: '80%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(28,28,30,0.98)',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  destination: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    maxWidth: '100%',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  stat: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
  },
  statDot: {
    color: 'rgba(255,255,255,0.5)',
  },
  button: {
    marginTop: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: '#0A84FF',
    borderRadius: 12,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
