import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistance } from '../../utils/units';
import { useNavigationStore } from '../../stores/navigationStore';

interface EtaDisplayProps {
  etaSeconds: number | null;
  remainingDistanceMeters: number | null;
  onExit?: () => void;
  onPreview?: () => void;
  isPreviewMode?: boolean;
}

export function EtaDisplay({
  etaSeconds,
  remainingDistanceMeters,
  onExit,
  onPreview,
  isPreviewMode,
}: EtaDisplayProps) {
  const trafficEtaSeconds = useNavigationStore((s) => s.trafficEtaSeconds);

  // Use traffic ETA when available, otherwise fall back to route ETA
  const displayEta = trafficEtaSeconds ?? etaSeconds;

  if (displayEta == null) return null;

  const arrival = new Date(Date.now() + displayEta * 1000);
  const arrivalStr = arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.eta}>{formatDuration(displayEta)}</Text>
        <Text style={styles.sub}>
          {remainingDistanceMeters != null ? `${formatDistance(remainingDistanceMeters)} · ` : ''}
          {arrivalStr}
        </Text>
      </View>
      <View style={styles.buttons}>
        {onPreview && (
          <TouchableOpacity
            style={[styles.previewBtn, isPreviewMode && styles.previewBtnActive]}
            onPress={onPreview}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isPreviewMode ? 'pause' : 'play'}
              size={18}
              color={isPreviewMode ? '#fff' : 'rgba(255,255,255,0.75)'}
            />
          </TouchableOpacity>
        )}
        {onExit && (
          <TouchableOpacity style={styles.exitBtn} onPress={onExit} activeOpacity={0.85}>
            <Text style={styles.exitText}>Exit</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins} min`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  info: {
    flex: 1,
  },
  eta: {
    fontSize: 32,
    fontWeight: '700',
    color: '#4ADE80',
    lineHeight: 36,
  },
  sub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewBtnActive: {
    backgroundColor: 'rgba(74,222,128,0.25)',
  },
  exitBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 999,
  },
  exitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
