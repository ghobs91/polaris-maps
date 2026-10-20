import type { TransitRouteLine } from '../../src/models/transit';
import { filterTransitLinesToBounds, transitLineBounds } from '../../src/utils/transitViewport';

function line(id: string, geometry: [number, number][][]): TransitRouteLine {
  return {
    id,
    ref: id,
    name: id,
    mode: 'SUBWAY',
    geometry,
    stops: [],
  };
}

const viewport = { minLat: 40.7, minLng: -74.1, maxLat: 40.8, maxLng: -73.9 };

describe('transitLineBounds', () => {
  it('computes the bounding box across all segments', () => {
    const bounds = transitLineBounds(
      line('a', [
        [
          [-74.05, 40.71],
          [-74.0, 40.75],
        ],
        [
          [-73.95, 40.73],
          [-73.99, 40.79],
        ],
      ]),
    );

    expect(bounds).toEqual({
      minLat: 40.71,
      maxLat: 40.79,
      minLng: -74.05,
      maxLng: -73.95,
    });
  });

  it('returns null for a line with no geometry points', () => {
    expect(transitLineBounds(line('empty', []))).toBeNull();
    expect(transitLineBounds(line('empty-segment', [[]]))).toBeNull();
  });
});

describe('filterTransitLinesToBounds', () => {
  it('keeps lines intersecting the viewport and drops distant ones', () => {
    const inside = line('inside', [
      [
        [-74.0, 40.75],
        [-73.98, 40.76],
      ],
    ]);
    // Boston — far outside a NYC viewport.
    const outside = line('outside', [
      [
        [-71.06, 42.35],
        [-71.05, 42.36],
      ],
    ]);

    expect(filterTransitLinesToBounds([inside, outside], viewport)).toEqual([inside]);
  });

  it('keeps lines just outside the viewport inside the padding margin', () => {
    // Starts ~0.01° north of the viewport; the 25% pad (~0.025°) covers it.
    const nearby = line('nearby', [
      [
        [-74.0, 40.81],
        [-73.98, 40.82],
      ],
    ]);

    expect(filterTransitLinesToBounds([nearby], viewport)).toEqual([nearby]);
  });

  it('drops lines with no drawable geometry', () => {
    expect(filterTransitLinesToBounds([line('empty', [])], viewport)).toEqual([]);
  });
});
