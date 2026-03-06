import { create } from 'zustand';
import type { Place, PlaceCategory } from '../models/poi';
import type { Review } from '../models/review';
import type { DataEdit } from '../models/dataEdit';

interface POIState {
  nearbyPlaces: Place[];
  searchResults: Place[];
  selectedPlace: Place | null;
  selectedPlaceReviews: Review[];
  pendingEdits: DataEdit[];
  isSearching: boolean;
  isLoadingPlace: boolean;
  filterCategory: PlaceCategory | null;

  setNearbyPlaces: (places: Place[]) => void;
  setSearchResults: (places: Place[]) => void;
  setSelectedPlace: (place: Place | null) => void;
  setSelectedPlaceReviews: (reviews: Review[]) => void;
  setPendingEdits: (edits: DataEdit[]) => void;
  setIsSearching: (searching: boolean) => void;
  setIsLoadingPlace: (loading: boolean) => void;
  setFilterCategory: (category: PlaceCategory | null) => void;
  clearSearch: () => void;
}

export const usePOIStore = create<POIState>((set) => ({
  nearbyPlaces: [],
  searchResults: [],
  selectedPlace: null,
  selectedPlaceReviews: [],
  pendingEdits: [],
  isSearching: false,
  isLoadingPlace: false,
  filterCategory: null,

  setNearbyPlaces: (places) => set({ nearbyPlaces: places }),
  setSearchResults: (places) => set({ searchResults: places }),
  setSelectedPlace: (place) => set({ selectedPlace: place }),
  setSelectedPlaceReviews: (reviews) => set({ selectedPlaceReviews: reviews }),
  setPendingEdits: (edits) => set({ pendingEdits: edits }),
  setIsSearching: (searching) => set({ isSearching: searching }),
  setIsLoadingPlace: (loading) => set({ isLoadingPlace: loading }),
  setFilterCategory: (category) => set({ filterCategory: category }),
  clearSearch: () => set({ searchResults: [], isSearching: false }),
}));
