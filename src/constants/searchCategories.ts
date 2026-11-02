import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export interface CategoryPill {
  id: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  searchQuery: string;
}

/** Quick POI category searches shown as pills on the map. */
export const SEARCH_CATEGORIES: CategoryPill[] = [
  { id: 'restaurants', label: 'Restaurants', icon: 'restaurant', searchQuery: 'restaurants' },
  { id: 'coffee', label: 'Coffee', icon: 'cafe', searchQuery: 'coffee' },
  { id: 'ev_charging', label: 'EV Charging', icon: 'flash', searchQuery: 'ev charging' },
  { id: 'gas_stations', label: 'Gas Stations', icon: 'car', searchQuery: 'gas stations' },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food', searchQuery: 'fast food' },
  { id: 'grocery', label: 'Grocery', icon: 'cart', searchQuery: 'grocery stores' },
  { id: 'parking', label: 'Parking', icon: 'car-outline', searchQuery: 'parking' },
];

/** Ids of the categories drivers stop for mid-route, in shortcut order. */
const ADD_STOP_SHORTCUT_IDS = ['gas_stations', 'ev_charging', 'fast_food', 'coffee'];

/**
 * One-tap shortcuts for adding a stop to an active route: fuel, charging, food
 * and coffee. Each runs its category query through the regular search.
 */
export const ADD_STOP_SHORTCUTS: CategoryPill[] = ADD_STOP_SHORTCUT_IDS.map((id) =>
  SEARCH_CATEGORIES.find((category) => category.id === id),
).filter((category): category is CategoryPill => category != null);
