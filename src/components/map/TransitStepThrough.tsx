import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildTransitSteps } from '../../services/transit/transitSteps';
import type { OtpItinerary } from '../../models/transit';

interface TransitStepThroughProps {
  visible: boolean;
  itinerary: OtpItinerary | null;
  onClose: () => void;
}

const MODE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  WALK: 'walk',
  BICYCLE: 'bicycle',
  BUS: 'bus',
  RAIL: 'train',
  SUBWAY: 'subway',
  TRAM: 'train-outline',
  FERRY: 'boat',
};

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDurationShort(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function routeColor(color?: string): string | undefined {
  return color && /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : undefined;
}

/** Step-by-step view of a transit itinerary (leg-by-leg, not automotive). */
export function TransitStepThrough({ visible, itinerary, onClose }: TransitStepThroughProps) {
  const steps = buildTransitSteps(itinerary);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Trip steps</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close trip steps"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>

          {steps.length === 0 ? (
            <Text style={styles.empty}>No steps available</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {steps.map((step) => (
                <View key={step.index} style={styles.step}>
                  <View
                    style={[
                      styles.iconWrap,
                      routeColor(step.routeColor)
                        ? { backgroundColor: routeColor(step.routeColor) }
                        : undefined,
                    ]}
                  >
                    <Ionicons
                      name={MODE_ICONS[step.mode] ?? 'help-circle'}
                      size={16}
                      color="#fff"
                    />
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepTitle} numberOfLines={2}>
                      {step.title}
                    </Text>
                    {step.detail ? <Text style={styles.stepDetail}>{step.detail}</Text> : null}
                    <Text style={styles.stepTime}>
                      {formatClock(step.startTime)} – {formatClock(step.endTime)} ·{' '}
                      {formatDurationShort(step.duration)}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'rgba(28,28,30,0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  empty: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingVertical: 24,
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBody: { flex: 1 },
  stepTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  stepDetail: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 },
  stepTime: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 3 },
});
