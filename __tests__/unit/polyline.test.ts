import { decodePolyline, encodePolyline } from '../../src/utils/polyline';

describe('polyline encode/decode', () => {
  it('round-trips coordinates through encode → decode', () => {
    const coords: [number, number][] = [
      [-74.006, 40.7128],
      [-73.9855, 40.758],
      [-73.99, 40.7614],
    ];
    const decoded = decodePolyline(encodePolyline(coords));
    expect(decoded).toHaveLength(coords.length);
    decoded.forEach(([lng, lat], i) => {
      expect(lng).toBeCloseTo(coords[i][0], 5);
      expect(lat).toBeCloseTo(coords[i][1], 5);
    });
  });

  it('encodes an empty array to an empty string', () => {
    expect(encodePolyline([])).toBe('');
  });

  it('decodes an empty string to an empty array', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});
