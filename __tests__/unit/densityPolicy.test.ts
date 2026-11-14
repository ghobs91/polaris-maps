import {
  MAX_TRAFFIC_TOPICS,
  MAX_TRAFFIC_TOPICS_METERED,
  isMeteredConnection,
  selectTrafficCells,
} from '../../src/services/traffic/densityPolicy';

const CELLS = ['9q8y', '9q8z', '9q8x', '9q8w', '9q8v', '9q8u', '9q8t', '9q8s', '9q8r'];

describe('isMeteredConnection', () => {
  it('treats cellular links as metered', () => {
    expect(isMeteredConnection('cellular')).toBe(true);
  });

  it('treats OS-flagged expensive Wi-Fi as metered', () => {
    expect(isMeteredConnection('wifi', true)).toBe(true);
  });

  it('keeps ordinary Wi-Fi and ethernet unmetered', () => {
    expect(isMeteredConnection('wifi', false)).toBe(false);
    expect(isMeteredConnection('ethernet', false)).toBe(false);
    expect(isMeteredConnection(undefined)).toBe(false);
  });
});

describe('selectTrafficCells', () => {
  it('joins the full neighbourhood on an unmetered link', () => {
    expect(selectTrafficCells(CELLS, false)).toEqual(CELLS.slice(0, MAX_TRAFFIC_TOPICS));
  });

  it('keeps only the centre cell on a metered link', () => {
    expect(MAX_TRAFFIC_TOPICS_METERED).toBe(1);
    expect(selectTrafficCells(CELLS, true)).toEqual([CELLS[0]]);
  });

  it('never invents cells beyond what the viewport produced', () => {
    expect(selectTrafficCells(['9q8y'], false)).toEqual(['9q8y']);
    expect(selectTrafficCells([], false)).toEqual([]);
  });
});
