jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getBoolean: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { useTransitStore } from '../../src/stores/transitStore';
import type { OtpItinerary, OtpStop } from '../../src/models/transit';

// ── Fixtures ────────────────────────────────────────────────────────

function makeStop(overrides: Partial<OtpStop> = {}): OtpStop {
  return {
    gtfsId: 'MTA:101',
    name: 'Penn Station',
    code: '1',
    lat: 40.75,
    lon: -73.99,
    routes: [],
    vehicleMode: 'SUBWAY',
    ...overrides,
  };
}

function makeItinerary(overrides: Partial<OtpItinerary> = {}): OtpItinerary {
  return {
    start: '2026-04-01T08:00:00-04:00',
    end: '2026-04-01T08:45:00-04:00',
    duration: 2700,
    walkDistance: 500,
    waitingTime: 0,
    transfers: 1,
    legs: [
      {
        mode: 'BUS',
        from: { name: 'A', lat: 40.7, lon: -74.0 },
        to: { name: 'B', lat: 40.75, lon: -73.99 },
        startTime: 1711958400000,
        endTime: 1711959600000,
        duration: 1200,
        distance: 3000,
        route: {
          gtfsId: 'MTA:M1',
          shortName: 'M1',
          longName: '5th Ave',
          color: '0F7E32',
          textColor: 'FFFFFF',
          mode: 'BUS',
          agency: { gtfsId: 'MTA:MTA', name: 'MTA' },
        },
        tripId: 'MTA:trip-1',
        headsign: 'South Ferry',
        intermediateStops: [],
        legGeometry: { points: '_p~iF~ps|U' },
        realTime: false,
        alerts: [],
      },
    ],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('transitStore', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useTransitStore.setState({
      transitLayerVisible: false,
      stops: [],
      isLoadingStops: false,
      itineraries: [],
      selectedItineraryIndex: 0,
      isLoadingItineraries: false,
      tripPlanError: null,
      enabledModes: ['BUS', 'RAIL', 'SUBWAY', 'TRAM', 'FERRY'],
      transitOrigin: null,
      transitDestination: null,
    });
  });

  describe('transitLayerVisible', () => {
    it('starts as false', () => {
      expect(useTransitStore.getState().transitLayerVisible).toBe(false);
    });

    it('can be toggled on', () => {
      useTransitStore.getState().setTransitLayerVisible(true);
      expect(useTransitStore.getState().transitLayerVisible).toBe(true);
    });
  });

  describe('stops', () => {
    it('can set stops', () => {
      const stops = [makeStop(), makeStop({ gtfsId: 'MTA:102', name: 'Times Square' })];
      useTransitStore.getState().setStops(stops);
      expect(useTransitStore.getState().stops).toHaveLength(2);
      expect(useTransitStore.getState().stops[1].name).toBe('Times Square');
    });

    it('tracks loading state', () => {
      useTransitStore.getState().setIsLoadingStops(true);
      expect(useTransitStore.getState().isLoadingStops).toBe(true);
      useTransitStore.getState().setIsLoadingStops(false);
      expect(useTransitStore.getState().isLoadingStops).toBe(false);
    });
  });

  describe('itineraries', () => {
    it('can set itineraries and resets selectedItineraryIndex', () => {
      // First select a different index
      useTransitStore.getState().setItineraries([makeItinerary(), makeItinerary()]);
      useTransitStore.getState().selectItinerary(1);
      expect(useTransitStore.getState().selectedItineraryIndex).toBe(1);

      // Setting new itineraries resets the selection
      useTransitStore.getState().setItineraries([makeItinerary()]);
      expect(useTransitStore.getState().selectedItineraryIndex).toBe(0);
      expect(useTransitStore.getState().itineraries).toHaveLength(1);
    });

    it('clears tripPlanError when setting itineraries', () => {
      useTransitStore.getState().setTripPlanError('Something went wrong');
      expect(useTransitStore.getState().tripPlanError).toBe('Something went wrong');

      useTransitStore.getState().setItineraries([makeItinerary()]);
      expect(useTransitStore.getState().tripPlanError).toBeNull();
    });

    it('can select a specific itinerary', () => {
      useTransitStore.getState().setItineraries([makeItinerary(), makeItinerary()]);
      useTransitStore.getState().selectItinerary(1);
      expect(useTransitStore.getState().selectedItineraryIndex).toBe(1);
    });
  });

  describe('enabledModes', () => {
    it('defaults to 5 common transit modes', () => {
      expect(useTransitStore.getState().enabledModes).toEqual([
        'BUS',
        'RAIL',
        'SUBWAY',
        'TRAM',
        'FERRY',
      ]);
    });

    it('can toggle a mode off', () => {
      useTransitStore.getState().toggleMode('FERRY');
      expect(useTransitStore.getState().enabledModes).not.toContain('FERRY');
      expect(useTransitStore.getState().enabledModes).toHaveLength(4);
    });

    it('can toggle a mode back on', () => {
      useTransitStore.getState().toggleMode('FERRY');
      useTransitStore.getState().toggleMode('FERRY');
      expect(useTransitStore.getState().enabledModes).toContain('FERRY');
    });

    it('does not allow removing the last mode', () => {
      // Remove all except BUS
      useTransitStore.getState().setEnabledModes(['BUS']);
      expect(useTransitStore.getState().enabledModes).toEqual(['BUS']);

      // Try to remove BUS — should be refused
      useTransitStore.getState().toggleMode('BUS');
      expect(useTransitStore.getState().enabledModes).toEqual(['BUS']);
    });

    it('can add a mode not in defaults', () => {
      useTransitStore.getState().toggleMode('GONDOLA');
      expect(useTransitStore.getState().enabledModes).toContain('GONDOLA');
    });
  });

  describe('transit origin/destination', () => {
    it('sets transit origin', () => {
      useTransitStore.getState().setTransitOrigin({ lat: 40.7, lng: -74.0, name: 'Home' });
      expect(useTransitStore.getState().transitOrigin).toEqual({
        lat: 40.7,
        lng: -74.0,
        name: 'Home',
      });
    });

    it('sets transit destination', () => {
      useTransitStore.getState().setTransitDestination({ lat: 40.75, lng: -73.99 });
      expect(useTransitStore.getState().transitDestination).toEqual({
        lat: 40.75,
        lng: -73.99,
      });
    });
  });

  describe('clearTransitPlan', () => {
    it('resets all trip planning state', () => {
      // Set up some state
      useTransitStore.getState().setItineraries([makeItinerary()]);
      useTransitStore.getState().selectItinerary(0);
      useTransitStore.getState().setTransitOrigin({ lat: 40.7, lng: -74.0 });
      useTransitStore.getState().setTransitDestination({ lat: 40.75, lng: -73.99 });
      useTransitStore.getState().setTripPlanError('old error');

      // Clear
      useTransitStore.getState().clearTransitPlan();

      const state = useTransitStore.getState();
      expect(state.itineraries).toEqual([]);
      expect(state.selectedItineraryIndex).toBe(0);
      expect(state.tripPlanError).toBeNull();
      expect(state.transitOrigin).toBeNull();
      expect(state.transitDestination).toBeNull();
    });

    it('does not affect stops or layer visibility', () => {
      const stops = [makeStop()];
      useTransitStore.getState().setStops(stops);
      useTransitStore.getState().setTransitLayerVisible(true);
      useTransitStore.getState().setItineraries([makeItinerary()]);

      useTransitStore.getState().clearTransitPlan();

      expect(useTransitStore.getState().stops).toEqual(stops);
      expect(useTransitStore.getState().transitLayerVisible).toBe(true);
    });
  });
});
