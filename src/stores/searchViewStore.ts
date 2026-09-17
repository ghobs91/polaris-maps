import { create } from 'zustand';
import type { SearchFilters, SortOption } from '../services/search/searchFilters';

interface SearchViewState {
  /** Explicit user filters (independent of intent-derived defaults). */
  filters: SearchFilters;
  sort: SortOption;
  setFilters: (filters: SearchFilters) => void;
  setSort: (sort: SortOption) => void;
  clearFilters: () => void;
}

/**
 * Session-scoped search view preferences (filters + sort). Not persisted —
 * filters reset between sessions.
 */
export const useSearchViewStore = create<SearchViewState>()((set) => ({
  filters: {},
  sort: 'relevance',
  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),
  clearFilters: () => set({ filters: {} }),
}));
