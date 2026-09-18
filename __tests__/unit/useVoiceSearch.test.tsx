import { act, renderHook } from '@testing-library/react-native';

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { useVoiceSearch } from '../../src/hooks/useVoiceSearch';

const speech = ExpoSpeechRecognitionModule as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
};

const onTranscript = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useVoiceSearch', () => {
  it('starts recognition when permission is already granted', async () => {
    speech.getPermissionsAsync.mockResolvedValue({ granted: true });

    const { result } = renderHook(() => useVoiceSearch({ onTranscript }));

    let started = false;
    await act(async () => {
      started = await result.current.start();
    });

    expect(started).toBe(true);
    expect(speech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US' }));
    expect(result.current.isListening).toBe(true);
  });

  it('requests permission just-in-time and starts when granted', async () => {
    speech.getPermissionsAsync.mockResolvedValue({ granted: false });
    speech.requestPermissionsAsync.mockResolvedValue({ granted: true });

    const { result } = renderHook(() => useVoiceSearch({ onTranscript }));

    await act(async () => {
      await result.current.start();
    });

    expect(speech.requestPermissionsAsync).toHaveBeenCalled();
    expect(speech.start).toHaveBeenCalled();
  });

  it('reports unavailable and does not start when permission is denied', async () => {
    speech.getPermissionsAsync.mockResolvedValue({ granted: false });
    speech.requestPermissionsAsync.mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useVoiceSearch({ onTranscript }));

    let started = true;
    await act(async () => {
      started = await result.current.start();
    });

    expect(started).toBe(false);
    expect(speech.start).not.toHaveBeenCalled();
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isListening).toBe(false);
  });

  it('stops recognition when toggled while listening', async () => {
    speech.getPermissionsAsync.mockResolvedValue({ granted: true });

    const { result } = renderHook(() => useVoiceSearch({ onTranscript }));

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      void result.current.toggle();
    });

    expect(speech.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });
});
