import { dashCamStartForNavigation } from '../../src/services/dashcam/dashCamStartLogic';

const BASE = {
  enabled: true,
  autoStart: false,
  autoStartPromptAnswered: false,
};

describe('dashCamStartForNavigation', () => {
  it('asks the one-time question before any answer is recorded', () => {
    expect(dashCamStartForNavigation(BASE)).toEqual({ ask: true, start: false });
  });

  it('auto-starts silently once the user chose every drive', () => {
    expect(
      dashCamStartForNavigation({ ...BASE, autoStart: true, autoStartPromptAnswered: true }),
    ).toEqual({ ask: false, start: true });
  });

  it('keeps the record button but never prompts again after "not now"', () => {
    expect(dashCamStartForNavigation({ ...BASE, autoStartPromptAnswered: true })).toEqual({
      ask: false,
      start: false,
    });
  });

  it('stays out of the way when the dash cam feature is off', () => {
    expect(dashCamStartForNavigation({ ...BASE, enabled: false })).toEqual({
      ask: false,
      start: false,
    });
    expect(
      dashCamStartForNavigation({
        ...BASE,
        enabled: false,
        autoStart: true,
        autoStartPromptAnswered: true,
      }),
    ).toEqual({ ask: false, start: false });
  });
});
