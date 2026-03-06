import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getPlaceById } from '../../src/services/poi/poiService';
import { submitEdit } from '../../src/services/poi/editService';
import { Button, LoadingSpinner, ErrorBoundary } from '../../src/components/common';
import { colors, spacing, typography, borderRadius } from '../../src/constants/theme';
import type { Place, PlaceStatus } from '../../src/models/poi';

export default function POIEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [place, setPlace] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [hours, setHours] = useState('');
  const [status, setStatus] = useState<PlaceStatus>('open');

  useEffect(() => {
    if (!id) return;
    (async () => {
      const p = await getPlaceById(id);
      if (p) {
        setPlace(p);
        setName(p.name);
        setPhone(p.phone ?? '');
        setWebsite(p.website ?? '');
        setHours(p.hours ?? '');
        setStatus(p.status);
      }
      setLoading(false);
    })();
  }, [id]);

  const handleSubmit = useCallback(async () => {
    if (!place || !id) return;

    const changes: Array<{ field: string; oldVal?: string; newVal?: string }> = [];
    if (name !== place.name) changes.push({ field: 'name', oldVal: place.name, newVal: name });
    if (phone !== (place.phone ?? ''))
      changes.push({ field: 'phone', oldVal: place.phone, newVal: phone || undefined });
    if (website !== (place.website ?? ''))
      changes.push({ field: 'website', oldVal: place.website, newVal: website || undefined });
    if (hours !== (place.hours ?? ''))
      changes.push({ field: 'hours', oldVal: place.hours, newVal: hours || undefined });
    if (status !== place.status)
      changes.push({ field: 'status', oldVal: place.status, newVal: status });

    if (changes.length === 0) {
      Alert.alert('No Changes', 'No changes detected to submit.');
      return;
    }

    setSubmitting(true);
    try {
      for (const change of changes) {
        await submitEdit('place', id, change.field, change.oldVal, change.newVal);
      }
      Alert.alert('Edit Submitted', 'Your edit has been submitted for community review.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [place, id, name, phone, website, hours, status, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingSpinner size="large" />
      </View>
    );
  }

  if (!place) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Place not found</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Suggest Edit</Text>
        <Text style={styles.subheading}>Changes will be reviewed by the community</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Place name"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Website</Text>
          <TextInput
            style={styles.input}
            value={website}
            onChangeText={setWebsite}
            placeholder="https://..."
            placeholderTextColor={colors.textSecondary}
            keyboardType="url"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Hours</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={hours}
            onChangeText={setHours}
            placeholder="e.g. Mon-Fri 9am-5pm"
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            {(['open', 'closed_temporarily', 'closed_permanently'] as const).map((s) => (
              <Button
                key={s}
                title={
                  s === 'open' ? 'Open' : s === 'closed_temporarily' ? 'Temp Closed' : 'Closed'
                }
                variant={status === s ? 'primary' : 'outline'}
                size="sm"
                onPress={() => setStatus(s)}
              />
            ))}
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            title={submitting ? 'Submitting…' : 'Submit Edit'}
            onPress={handleSubmit}
            variant="primary"
            disabled={submitting}
          />
          <Button title="Cancel" onPress={() => router.back()} variant="outline" />
        </View>
      </ScrollView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  subheading: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  errorText: { ...typography.body, color: colors.error },
  field: { marginBottom: spacing.md },
  label: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  statusRow: { flexDirection: 'row', gap: spacing.sm },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
