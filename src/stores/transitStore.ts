import { create } from 'zustand';
import { storage } from '../services/storage/mmkv';
import type {
  OtpItinerary,
  OtpStop,
  TransitMode,
  TransitRouteLine,
  SelectedTransitStop,
} from '../models/transit';

const TRANSIT_LAYER_KEY = 'transitLayerVisible';

interface TransitState {
  // Transit layer visibility
  transitLayerVisible: boolean;

  // Route lines visible on the map
  routeLines: TransitRouteLine[];
  isLoadingLines: boolean;

  // Stops currently visible on the map
  stops: OtpStop[];
  isLoadingStops: boolean;

  // Selected stop (for departure card)
  selectedStop: SelectedTransitStop | null;

  // Trip planning
  itineraries: OtpItinerary[];
  selectedItineraryIndex: number;
  isLoadingItineraries: boolean;
  tripPlanError: string | null;

  // Transit mode filter
  enabledModes: TransitMode[];

  // Transit routing destination (separate from car navigation)
  transitOrigin: { lat: number; lng: number; name?: string } | null;
  transitDestination: { lat: number; lng: number; name?: string } | null;

  // Actions
  setTransitLayerVisible: (visible: boolean) => void;
  setRouteLines: (lines: TransitRouteLine[]) => void;
  setIsLoadingLines: (loading: boolean) => void;
  setStops: (stops: OtpStop[]) => void;
  setIsLoadingStops: (loading: boolean) => void;
  setSelectedStop: (stop: SelectedTransitStop | null) => void;
  setItineraries: (itineraries: OtpItinerary[]) => void;
  selectItinerary: (index: number) => void;
  setIsLoadingItineraries: (loading: boolean) => void;
  setTripPlanError: (error: string | null) => void;
  setEnabledModes: (modes: TransitMode[]) => void;
  toggleMode: (mode: TransitMode) => void;
  setTransitOrigin: (origin: TransitState['transitOrigin']) => void;
  setTransitDestination: (destination: TransitState['transitDestination']) => void;
  clearTransitPlan: () => void;
}

export const useTransitStore = create<TransitState>()((set, get) => ({
  transitLayerVisible: storage.getBoolean(TRANSIT_LAYER_KEY) ?? false,
  routeLines: [],
  isLoadingLines: false,
  stops: [],
  isLoadingStops: false,
  selectedStop: null,
  itineraries: [],
  selectedItineraryIndex: 0,
  isLoadingItineraries: false,
  tripPlanError: null,
  enabledModes: ['RAIL', 'SUBWAY', 'TRAM'],
  transitOrigin: null,
  transitDestination: null,

  setTransitLayerVisible: (visible) => {
    set({ transitLayerVisible: visible });
    storage.set(TRANSIT_LAYER_KEY, visible);
  },
  setRouteLines: (lines) => set({ routeLines: lines }),
  setIsLoadingLines: (loading) => set({ isLoadingLines: loading }),
  setStops: (stops) => set({ stops }),
  setIsLoadingStops: (loading) => set({ isLoadingStops: loading }),
  setSelectedStop: (stop) => set({ selectedStop: stop }),
  setItineraries: (itineraries) =>
    set({ itineraries, selectedItineraryIndex: 0, tripPlanError: null }),
  selectItinerary: (index) => set({ selectedItineraryIndex: index }),
  setIsLoadingItineraries: (loading) => set({ isLoadingItineraries: loading }),
  setTripPlanError: (error) => set({ tripPlanError: error }),
  setEnabledModes: (modes) => set({ enabledModes: modes }),
  toggleMode: (mode) => {
    const current = get().enabledModes;
    if (current.includes(mode)) {
      // Don't allow removing the last mode
      if (current.length > 1) {
        set({ enabledModes: current.filter((m) => m !== mode) });
      }
    } else {
      set({ enabledModes: [...current, mode] });
    }
  },
  setTransitOrigin: (origin) => set({ transitOrigin: origin }),
  setTransitDestination: (destination) => set({ transitDestination: destination }),
  clearTransitPlan: () =>
    set({
      itineraries: [],
      selectedItineraryIndex: 0,
      tripPlanError: null,
      transitOrigin: null,
      transitDestination: null,
    }),
}));
