import React, { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ValhallaManeuver, ValhallaRoute } from '../../models/route';
import { formatDistance } from '../../utils/units';

interface NavigationStepsListProps {
  visible: boolean;
  route: ValhallaRoute | null;
  currentStepIndex: number;
  onClose: () => void;
}

/** Full maneuver list shown during navigation, highlighting the current step. */
export function NavigationStepsList({
  visible,
  route,
  currentStepIndex,
  onClose,
}: NavigationStepsListProps) {
  const maneuvers = useMemo<ValhallaManeuver[]>(
    () => route?.legs.flatMap((leg) => leg.maneuvers) ?? [],
    [route],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Steps</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close steps"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>

          {maneuvers.length === 0 ? (
            <Text style={styles.empty}>No steps available</Text>
          ) : (
            <FlatList
              data={maneuvers}
              keyExtractor={(_, index) => String(index)}
              showsVerticalScrollIndicator={false}
              initialScrollIndex={Math.max(0, currentStepIndex - 1)}
              getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
              renderItem={({ item, index }) => {
                const isCurrent = index === currentStepIndex;
                return (
                  <View style={[styles.row, isCurrent && styles.rowCurrent]}>
                    <View style={[styles.index, isCurrent && styles.indexCurrent]}>
                      <Text style={[styles.indexText, isCurrent && styles.indexTextCurrent]}>
                        {index + 1}
                      </Text>
                    </View>
                    <View style={styles.body}>
                      <Text
                        style={[styles.instruction, isCurrent && styles.instructionCurrent]}
                        numberOfLines={2}
                      >
                        {item.instruction || item.verbalPreTransition || 'Continue'}
                      </Text>
                      {typeof item.distanceMeters === 'number' && item.distanceMeters > 0 ? (
                        <Text style={styles.distance}>{formatDistance(item.distanceMeters)}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              }}
            />
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
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 56,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  rowCurrent: { backgroundColor: 'rgba(64,156,255,0.18)' },
  index: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexCurrent: { backgroundColor: '#0A84FF' },
  indexText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' },
  indexTextCurrent: { color: '#fff' },
  body: { flex: 1 },
  instruction: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  instructionCurrent: { color: '#fff', fontWeight: '700' },
  distance: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
});
