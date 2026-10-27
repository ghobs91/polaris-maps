import type { DashCamClip } from '../../src/models/dashCam';
import { planDashCamPrune } from '../../src/services/dashcam/dashCamRetention';

const MINUTE = 60_000;
const MB = 1024 * 1024;

function clip(id: string, minute: number, durationMin: number, mb: number): DashCamClip {
  return {
    id,
    localUri: `file:///dashcam/${id}.mp4`,
    startedAt: Date.UTC(2026, 9, 26, 14, minute),
    durationMs: durationMin * MINUTE,
    bytes: mb * MB,
    createdAt: Date.UTC(2026, 9, 26, 14, minute),
  };
}

describe('planDashCamPrune', () => {
  it('keeps everything under both caps', () => {
    const clips = [clip('b', 1, 1, 40), clip('a', 0, 1, 40)];

    const plan = planDashCamPrune(clips, { maxMinutes: 10, maxBytes: 200 * MB });

    expect(plan.drop).toEqual([]);
    expect(plan.keep.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest clips until the byte cap is met', () => {
    const clips = [clip('a', 0, 1, 100), clip('b', 1, 1, 100), clip('c', 2, 1, 100)];

    const plan = planDashCamPrune(clips, { maxMinutes: 60, maxBytes: 250 * MB });

    expect(plan.drop.map((entry) => entry.id)).toEqual(['a']);
    expect(plan.keep.map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('drops the oldest clips until the time cap is met', () => {
    const clips = [clip('a', 0, 10, 10), clip('b', 10, 10, 10), clip('c', 20, 10, 10)];

    const plan = planDashCamPrune(clips, { maxMinutes: 25, maxBytes: 1000 * MB });

    expect(plan.drop.map((entry) => entry.id)).toEqual(['a']);
    expect(plan.keep).toHaveLength(2);
  });

  it('uses whichever cap binds first when both apply', () => {
    const clips = [
      clip('a', 0, 5, 300),
      clip('b', 5, 5, 300),
      clip('c', 10, 5, 300),
      clip('d', 15, 5, 300),
    ];

    // Duration alone would keep three clips; the byte cap keeps one.
    const plan = planDashCamPrune(clips, { maxMinutes: 15, maxBytes: 400 * MB });

    expect(plan.keep.map((entry) => entry.id)).toEqual(['d']);
  });

  it('treats a non-positive cap as unlimited', () => {
    const clips = [clip('a', 0, 30, 500), clip('b', 30, 30, 500)];

    const plan = planDashCamPrune(clips, { maxMinutes: 0, maxBytes: 0 });

    expect(plan.drop).toEqual([]);
  });

  it('drops every clip when a single clip exceeds the cap', () => {
    const plan = planDashCamPrune([clip('a', 0, 90, 900)], {
      maxMinutes: 30,
      maxBytes: 2000 * MB,
    });

    expect(plan.drop.map((entry) => entry.id)).toEqual(['a']);
    expect(plan.keep).toEqual([]);
  });
});
