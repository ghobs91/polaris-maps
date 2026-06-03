import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  submitIncidentReport,
  INCIDENT_TYPE_LABELS,
  INCIDENT_TYPE_ICONS,
} from '../../services/traffic/incidentReportService';
import type { IncidentType } from '../../models/traffic';

const INCIDENT_TYPES: IncidentType[] = [
  'accident',
  'road_closure',
  'hazard',
  'construction',
  'police',
  'other',
];

interface IncidentReportPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Current GPS position [lng, lat] */
  position: [number, number];
}

export function IncidentReportPanel({ visible, onClose, position }: IncidentReportPanelProps) {
  const [selectedType, setSelectedType] = useState<IncidentType | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!selectedType) return;
    setSubmitting(true);
    try {
      await submitIncidentReport(
        position[1], // lat
        position[0], // lng
        selectedType,
        description.trim(),
      );
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setSelectedType(null);
        setDescription('');
        onClose();
      }, 1500);
    } catch {
      // Silently fail — user can try again
    } finally {
      setSubmitting(false);
    }
  }, [selectedType, description, position, onClose]);

  const handleClose = useCallback(() => {
    setSelectedType(null);
    setDescription('');
    setSubmitted(false);
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Report Incident</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>

          {submitted ? (
            <View style={styles.successContainer}>
              <Ionicons name="checkmark-circle" size={48} color="#4ADE80" />
              <Text style={styles.successText}>Report submitted</Text>
              <Text style={styles.successSubtext}>Thanks for helping the community</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Type selection */}
              <Text style={styles.sectionLabel}>What's happening?</Text>
              <View style={styles.typeGrid}>
                {INCIDENT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeChip, selectedType === type && styles.typeChipActive]}
                    onPress={() => setSelectedType(type)}
                    activeOpacity={0.7}
                    accessibilityLabel={INCIDENT_TYPE_LABELS[type]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: selectedType === type }}
                  >
                    <Ionicons
                      name={INCIDENT_TYPE_ICONS[type] as any}
                      size={22}
                      color={selectedType === type ? '#fff' : 'rgba(255,255,255,0.6)'}
                    />
                    <Text
                      style={[styles.typeLabel, selectedType === type && styles.typeLabelActive]}
                      numberOfLines={1}
                    >
                      {INCIDENT_TYPE_LABELS[type]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Description */}
              <Text style={styles.sectionLabel}>Description (optional)</Text>
              <TextInput
                style={styles.descriptionInput}
                value={description}
                onChangeText={setDescription}
                placeholder="Add details..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                multiline
                numberOfLines={3}
                maxLength={200}
                accessibilityLabel="Incident description"
                accessibilityHint="Optional details about the incident"
              />

              {/* Submit button */}
              <TouchableOpacity
                style={[styles.submitBtn, !selectedType && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!selectedType || submitting}
                activeOpacity={0.85}
                accessibilityLabel="Submit report"
                accessibilityRole="button"
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Submit Report</Text>
                )}
              </TouchableOpacity>
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
  panel: {
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
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 8,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  typeChipActive: {
    backgroundColor: 'rgba(64,156,255,0.2)',
    borderColor: '#409CFF',
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
  },
  typeLabelActive: {
    color: '#fff',
  },
  descriptionInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  submitBtn: {
    backgroundColor: '#409CFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  successText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  successSubtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
});
