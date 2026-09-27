// `units.ts` reads its unit preference from the settings store, which reaches
// for encrypted storage on import. Mocked here so this suite can run without a
// native runtime, matching carPlayManager.test.ts.
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

import {
  laneGlyph,
  maneuverGlyph,
  LANE_DIRECTIONS,
  MANEUVER_TYPES,
} from '../../src/components/navigation/maneuverGlyphs';
import { formatDistance, formatDistanceParts } from '../../src/utils/units';
// The font's own glyph map. An icon name that is not a key here renders as a
// blank box at runtime and logs nothing, so this test is the only thing that
// catches a typo'd glyph.
import glyphMap from '../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

const KNOWN_GLYPHS = new Set(Object.keys(glyphMap));

describe('maneuverGlyphs', () => {
  describe('glyph names resolve in the font', () => {
    it.each(MANEUVER_TYPES)('maneuver %s uses a real MaterialCommunityIcons glyph', (type) => {
      const { name } = maneuverGlyph(type);
      expect(KNOWN_GLYPHS.has(name)).toBe(true);
    });

    it.each(LANE_DIRECTIONS)('lane %s uses a real MaterialCommunityIcons glyph', (direction) => {
      for (const active of [true, false]) {
        const { name } = laneGlyph(direction, active);
        expect(KNOWN_GLYPHS.has(name)).toBe(true);
      }
    });
  });

  describe('maneuver coverage', () => {
    it('covers every ManeuverType in the model', () => {
      const modelTypes: string[] = [
        'start',
        'destination',
        'turn_left',
        'turn_right',
        'sharp_left',
        'sharp_right',
        'slight_left',
        'slight_right',
        'continue',
        'u_turn',
        'merge_left',
        'merge_right',
        'enter_roundabout',
        'exit_roundabout',
        'enter_highway',
        'exit_highway',
        'ferry',
        'name_change',
      ];
      expect([...MANEUVER_TYPES].sort()).toEqual(modelTypes.slice().sort());
    });

    it('mirrors left and right turns', () => {
      expect(maneuverGlyph('turn_left').rotate).toBe(-maneuverGlyph('turn_right').rotate);
      expect(maneuverGlyph('slight_left').rotate).toBe(-maneuverGlyph('slight_right').rotate);
      expect(maneuverGlyph('sharp_left').rotate).toBe(-maneuverGlyph('sharp_right').rotate);
      expect(maneuverGlyph('merge_left').rotate).toBe(-maneuverGlyph('merge_right').rotate);
    });

    it('leaves already-directional glyphs unrotated', () => {
      // Rotating these would point them away from the maneuver they describe.
      for (const type of [
        'u_turn',
        'enter_roundabout',
        'exit_roundabout',
        'exit_highway',
      ] as const) {
        expect(maneuverGlyph(type).rotate).toBe(0);
      }
    });

    it('falls back to straight ahead for an unknown or missing type', () => {
      expect(maneuverGlyph(undefined)).toEqual(maneuverGlyph('continue'));
      expect(maneuverGlyph(null)).toEqual(maneuverGlyph('continue'));
      expect(maneuverGlyph('something_new' as never)).toEqual(maneuverGlyph('continue'));
    });
  });

  describe('lane arrows', () => {
    it('keeps the same rotation for a lane whichever weight it renders at', () => {
      for (const direction of LANE_DIRECTIONS) {
        expect(laneGlyph(direction, true).rotate).toBe(laneGlyph(direction, false).rotate);
      }
    });

    it('gives the recommended lane a heavier glyph', () => {
      expect(laneGlyph('straight', true).name).toBe('arrow-up-bold');
      expect(laneGlyph('straight', false).name).toBe('arrow-up-thin');
    });

    it('uses the directional U-turn glyph at both weights', () => {
      expect(laneGlyph('u_turn', true).name).toBe('arrow-u-left-top');
      expect(laneGlyph('u_turn', false).name).toBe('arrow-u-left-top');
    });
  });
});

describe('formatDistanceParts', () => {
  it('joins back into exactly what formatDistance returns', () => {
    const samples = [0, 10, 50, 120, 160, 804, 1609, 8046, 40233, 160934, 1000000];
    for (const meters of samples) {
      for (const metric of [true, false]) {
        const { value, unit } = formatDistanceParts(meters, metric);
        expect(`${value} ${unit}`).toBe(formatDistance(meters, metric));
      }
    }
  });

  it('splits the numeral from the unit', () => {
    expect(formatDistanceParts(1609.344, false)).toEqual({ value: '1.0', unit: 'mi' });
    expect(formatDistanceParts(1000, true)).toEqual({ value: '1.0', unit: 'km' });
    expect(formatDistanceParts(804, true)).toEqual({ value: '804', unit: 'm' });
  });

  it('rounds short imperial distances to the same 50 ft buckets as before', () => {
    // 100 m ≈ 328 ft → nearest 50 ft bucket.
    expect(formatDistanceParts(100, false)).toEqual({ value: '350', unit: 'ft' });
    // Below the bucket size the value floors at 50 ft rather than showing 0.
    expect(formatDistanceParts(1, false)).toEqual({ value: '50', unit: 'ft' });
  });
});
