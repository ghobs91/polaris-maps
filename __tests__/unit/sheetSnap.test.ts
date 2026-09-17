import { resolveSheetSnap, snapTopsForFractions } from '../../src/utils/sheetSnap';

const H = 1000;
const snapTops = snapTopsForFractions([0.35, 0.6, 0.92], H); // [80, 400, 650]

function resolve(overrides: Partial<Parameters<typeof resolveSheetSnap>[0]> = {}) {
  return resolveSheetSnap({
    currentTop: 400,
    snapTops,
    velocityY: 0,
    screenHeight: H,
    ...overrides,
  });
}

describe('snapTopsForFractions', () => {
  it('converts ascending fractions into ascending top positions', () => {
    expect(snapTops[0]).toBeCloseTo(80);
    expect(snapTops[1]).toBeCloseTo(400);
    expect(snapTops[2]).toBeCloseTo(650);
    expect(snapTops).toEqual([...snapTops].sort((a, b) => a - b));
  });
});

describe('resolveSheetSnap', () => {
  it('snaps to the nearest point when released at rest', () => {
    expect(resolve({ currentTop: 80 })).toEqual({ dismiss: false, index: 0 });
    expect(resolve({ currentTop: 400 })).toEqual({ dismiss: false, index: 1 });
    expect(resolve({ currentTop: 650 })).toEqual({ dismiss: false, index: 2 });
  });

  it('dismisses on a fast downward fling', () => {
    expect(resolve({ currentTop: 400, velocityY: 1200 })).toEqual({
      dismiss: true,
      index: snapTops.length - 1,
    });
  });

  it('dismisses when projected below the lowest snap', () => {
    // 950 > 650 + 0.25 * 1000
    expect(resolve({ currentTop: 950 })).toEqual({ dismiss: true, index: snapTops.length - 1 });
  });

  it('projects upward velocity toward a taller snap', () => {
    expect(resolve({ currentTop: 500, velocityY: -600 })).toEqual({ dismiss: false, index: 1 });
  });

  it('treats an empty snap set as a dismissal', () => {
    expect(resolve({ snapTops: [] })).toEqual({ dismiss: true, index: 0 });
  });
});
