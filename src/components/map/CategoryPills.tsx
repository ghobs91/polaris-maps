import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

export interface CategoryPill {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  searchQuery: string;
}

const CATEGORIES: CategoryPill[] = [
  { id: 'restaurants', label: 'Restaurants', icon: 'restaurant', searchQuery: 'restaurants' },
  { id: 'coffee', label: 'Coffee', icon: 'cafe', searchQuery: 'coffee' },
  { id: 'ev_charging', label: 'EV Charging', icon: 'flash', searchQuery: 'ev charging' },
  { id: 'gas_stations', label: 'Gas Stations', icon: 'car', searchQuery: 'gas stations' },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food', searchQuery: 'fast food' },
  { id: 'grocery', label: 'Grocery', icon: 'cart', searchQuery: 'grocery stores' },
  { id: 'parking', label: 'Parking', icon: 'car-outline', searchQuery: 'parking' },
];

interface CategoryPillsProps {
  onCategoryPress: (categoryId: string, query: string) => void;
  activeCategory?: string | null;
  /** Whether a category search is currently in progress */
  loading?: boolean;
}

/**
 * Horizontally scrolling list of category pills for quick POI searches.
 * Appears above the search bar in the FloatingSearchPanel.
 */
export function CategoryPills({ onCategoryPress, activeCategory, loading }: CategoryPillsProps) {
  const { colors, isDark } = useTheme();

  const pillBg = isDark ? 'rgba(28,28,30,0.93)' : 'rgba(255,255,255,0.93)';
  const pillBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const labelColor = isDark ? '#EBEBF5' : colors.text;
  const inactiveIconColor = colors.primary;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      accessibilityRole="toolbar"
      accessibilityLabel="Quick category search"
    >
      {CATEGORIES.map((category) => {
        const isActive = activeCategory === category.id;
        const showLoading = isActive && loading;
        return (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.pill,
              { backgroundColor: pillBg, borderColor: pillBorder },
              isActive && styles.pillActive,
            ]}
            onPress={() => onCategoryPress(category.id, category.searchQuery)}
            activeOpacity={0.7}
            accessibilityLabel={category.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            {showLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons
                name={category.icon}
                size={16}
                color={isActive ? '#FFFFFF' : inactiveIconColor}
              />
            )}
            <Text style={[styles.label, { color: labelColor }, isActive && styles.labelActive]}>
              {category.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  pillActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  labelActive: {
    color: '#FFFFFF',
  },
});
