import {
  ANNOUNCEMENT_BANDS,
  VoiceAnnouncementTracker,
  announcementText,
  bandForDistance,
} from '../../src/services/tts/voiceGuidance';

describe('bandForDistance', () => {
  it('maps distances into descending bands', () => {
    expect(bandForDistance(2000)).toBeNull();
    expect(bandForDistance(1600)).toBe('far');
    expect(bandForDistance(800)).toBe('mid');
    expect(bandForDistance(300)).toBe('near');
    expect(bandForDistance(80)).toBe('now');
    expect(bandForDistance(10)).toBe('now');
  });

  it('returns null for invalid distances', () => {
    expect(bandForDistance(Number.NaN)).toBeNull();
    expect(bandForDistance(-5)).toBeNull();
  });

  it('exposes bands in descending distance order', () => {
    const maxes = ANNOUNCEMENT_BANDS.map((b) => b.maxMeters);
    expect(maxes).toEqual([...maxes].sort((a, b) => b - a));
  });
});

describe('announcementText', () => {
  const fmt = (m: number) => `${Math.round(m)} m`;

  it('prefixes distance for non-immediate bands', () => {
    expect(announcementText('far', 1500, 'turn right', fmt)).toBe('In 1500 m, turn right');
    expect(announcementText('near', 250, 'turn right', fmt)).toBe('In 250 m, turn right');
  });

  it('speaks the bare instruction for the immediate band', () => {
    expect(announcementText('now', 40, 'turn right', fmt)).toBe('turn right');
  });

  it('ignores empty instructions', () => {
    expect(announcementText('mid', 700, '   ', fmt)).toBe('');
  });
});

describe('VoiceAnnouncementTracker', () => {
  it('announces each band once, far to near', () => {
    const tracker = new VoiceAnnouncementTracker();
    expect(tracker.next('m1', 1500)?.band).toBe('far');
    expect(tracker.next('m1', 1500)).toBeNull();
    expect(tracker.next('m1', 750)?.band).toBe('mid');
    expect(tracker.next('m1', 250)?.band).toBe('near');
    expect(tracker.next('m1', 50)?.band).toBe('now');
  });

  it('resets when the maneuver changes', () => {
    const tracker = new VoiceAnnouncementTracker();
    expect(tracker.next('m1', 50)?.band).toBe('now');
    expect(tracker.next('m2', 50)?.band).toBe('now');
  });

  it('skips bands already passed when the vehicle jumps in close', () => {
    const tracker = new VoiceAnnouncementTracker();
    expect(tracker.next('m1', 250)?.band).toBe('near');
    // A farther prompt must not fire after the vehicle is already near.
    expect(tracker.next('m1', 1200)).toBeNull();
    // The nearer band still fires when reached.
    expect(tracker.next('m1', 40)?.band).toBe('now');
  });

  it('clears state on reset', () => {
    const tracker = new VoiceAnnouncementTracker();
    expect(tracker.next('m1', 50)?.band).toBe('now');
    tracker.reset();
    expect(tracker.next('m1', 50)?.band).toBe('now');
  });
});
