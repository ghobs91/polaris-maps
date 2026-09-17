import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSearchViewStore } from '../../stores/searchViewStore';
import {
  isFilterEmpty,
  type SearchFilters,
  type SortOption,
} from '../../services/search/searchFilters';

interface SearchFilterSheetProps {
  visible: boolean;
  onClose: () => void;
}

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: 'Relevance', value: 'relevance' },
  { label: 'Distance', value: 'distance' },
  { label: 'Rating', value: 'rating' },
  { label: 'Price', value: 'price' },
];

const RATING_OPTIONS = [
  { label: 'Any', value: undefined as number | undefined },
  { label: '3+', value: 3 },
  { label: '4+', value: 4 },
  { label: '4.5+', value: 4.5 },
];

const PRICE_OPTIONS = [
  { label: 'Any', value: undefined as number | undefined },
  { label: '$', value: 1 },
  { label: '$$', value: 2 },
  { label: '$$$', value: 3 },
];

const DISTANCE_OPTIONS = [
  { label: 'Any', value: undefined as number | undefined },
  { label: '1 km', value: 1 },
  { label: '5 km', value: 5 },
  { label: '10 km', value: 10 },
  { label: '25 km', value: 25 },
];

const CATEGORY_OPTIONS = [
  { label: 'Cafe', value: 'cafe' },
  { label: 'Restaurant', value: 'restaurant' },
  { label: 'Bar', value: 'bar' },
  { label: 'Fast food', value: 'fast_food' },
  { label: 'Grocery', value: 'supermarket' },
  { label: 'Hotel', value: 'hotel' },
  { label: 'Pharmacy', value: 'pharmacy' },
  { label: 'Fuel', value: 'fuel' },
  { label: 'Parking', value: 'parking' },
];

/** Bottom sheet for search filters and sort order. */
export function SearchFilterSheet({ visible, onClose }: SearchFilterSheetProps) {
  const filters = useSearchViewStore((s) => s.filters);
  const sort = useSearchViewStore((s) => s.sort);
  const setFilters = useSearchViewStore((s) => s.setFilters);
  const setSort = useSearchViewStore((s) => s.setSort);
  const clearFilters = useSearchViewStore((s) => s.clearFilters);

  const update = (patch: Partial<SearchFilters>) => setFilters({ ...filters, ...patch });

  const toggleCategory = (value: string) => {
    const current = new Set(filters.categories ?? []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    const next = [...current];
    update({ categories: next.length > 0 ? next : undefined });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Filters & Sort</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.section}>Sort by</Text>
            <ChipRow
              options={SORT_OPTIONS}
              isActive={(v) => sort === v}
              onSelect={(v) => setSort(v)}
            />

            <Text style={styles.section}>Open now</Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Only show places open now</Text>
              <Switch
                value={filters.openNow === true}
                onValueChange={(v) => update({ openNow: v ? true : undefined })}
                trackColor={{ false: '#39393D', true: '#0A84FF' }}
              />
            </View>

            <Text style={styles.section}>Minimum rating</Text>
            <ChipRow
              options={RATING_OPTIONS}
              isActive={(v) => filters.minRating === v}
              onSelect={(v) => update({ minRating: v })}
            />

            <Text style={styles.section}>Max price</Text>
            <ChipRow
              options={PRICE_OPTIONS}
              isActive={(v) => filters.maxPriceLevel === v}
              onSelect={(v) => update({ maxPriceLevel: v })}
            />

            <Text style={styles.section}>Max distance</Text>
            <ChipRow
              options={DISTANCE_OPTIONS}
              isActive={(v) => filters.maxDistanceKm === v}
              onSelect={(v) => update({ maxDistanceKm: v })}
            />

            <Text style={styles.section}>Categories</Text>
            <ChipRow
              options={CATEGORY_OPTIONS}
              isActive={(v) => (filters.categories ?? []).includes(v)}
              onSelect={toggleCategory}
            />
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.clearBtn}
              onPress={() => {
                clearFilters();
                setSort('relevance');
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
            >
              <Text style={styles.clearText}>Clear all</Text>
            </Pressable>
            <Pressable
              style={[styles.doneBtn, isFilterEmpty(filters) && styles.doneBtnMuted]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Apply filters"
            >
              <Text style={styles.doneText}>{isFilterEmpty(filters) ? 'Done' : 'Apply'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface ChipOption<T> {
  label: string;
  value: T;
}

function ChipRow<T>({
  options,
  isActive,
  onSelect,
}: {
  options: ChipOption<T>[];
  isActive: (value: T) => boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const active = isActive(option.value);
        return (
          <Pressable
            key={option.label}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'rgba(28,28,30,0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  section: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: { backgroundColor: 'rgba(64,156,255,0.22)', borderColor: '#409CFF' },
  chipText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 20 },
  clearBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  clearText: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  doneBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#0A84FF',
  },
  doneBtnMuted: { backgroundColor: 'rgba(10,132,255,0.6)' },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
