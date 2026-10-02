import { describeOpeningStatus, formatClockTime } from '../../src/utils/openingStatus';

// 2026-10-07 is a Wednesday; 2026-10-10 a Saturday.
const wednesday = (h: number, m = 0) => new Date(2026, 9, 7, h, m);
const saturday = (h: number, m = 0) => new Date(2026, 9, 10, h, m);

describe('formatClockTime', () => {
  it('formats on-the-hour and half-hour times', () => {
    expect(formatClockTime(8 * 60)).toBe('8 AM');
    expect(formatClockTime(8 * 60 + 30)).toBe('8:30 AM');
    expect(formatClockTime(12 * 60)).toBe('12 PM');
    expect(formatClockTime(17 * 60)).toBe('5 PM');
    expect(formatClockTime(0)).toBe('12 AM');
  });
});

describe('describeOpeningStatus', () => {
  it('treats 24/7 as always open', () => {
    expect(describeOpeningStatus('24/7', wednesday(3))).toEqual({
      open: true,
      text: 'Open 24 hours',
    });
  });

  it('reports open with the closing time', () => {
    expect(describeOpeningStatus('Mo-Fr 09:00-17:00', wednesday(10))).toEqual({
      open: true,
      text: 'Open · Closes 5 PM',
    });
  });

  it('reports closed with the next opening later the same day', () => {
    expect(describeOpeningStatus('Mo-Fr 09:00-17:00', wednesday(7))).toEqual({
      open: false,
      text: 'Closed · Opens 9 AM',
    });
  });

  it('names the weekday when the next opening is not tomorrow', () => {
    expect(describeOpeningStatus('Mo-Fr 09:00-17:00', saturday(12))).toEqual({
      open: false,
      text: 'Closed · Opens Mon 9 AM',
    });
  });

  it('omits the weekday when the next opening is tomorrow', () => {
    expect(describeOpeningStatus('Mo-Su 08:00-22:00', wednesday(23))).toEqual({
      open: false,
      text: 'Closed · Opens 8 AM',
    });
  });

  it('handles multiple ranges in a day', () => {
    const hours = 'Mo-Fr 09:00-12:00,13:00-17:00';
    expect(describeOpeningStatus(hours, wednesday(12, 30))).toEqual({
      open: false,
      text: 'Closed · Opens 1 PM',
    });
    expect(describeOpeningStatus(hours, wednesday(14))).toEqual({
      open: true,
      text: 'Open · Closes 5 PM',
    });
  });

  it('handles overnight ranges that wrap past midnight', () => {
    expect(describeOpeningStatus('Fr 20:00-02:00', saturday(1))).toEqual({
      open: true,
      text: 'Open · Closes 2 AM',
    });
  });

  it('returns unknown for missing or unparseable hours', () => {
    expect(describeOpeningStatus(null, wednesday(10))).toEqual({ open: null, text: null });
    expect(describeOpeningStatus('by appointment', wednesday(10))).toEqual({
      open: null,
      text: null,
    });
  });
});
