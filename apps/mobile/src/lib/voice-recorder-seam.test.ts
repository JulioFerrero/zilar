import { describe, expect, it, vi } from 'vitest';

import {
  createVoiceRecorder,
  MIC_DENIED_MESSAGE,
  MIC_FAILED_MESSAGE,
  RECORD_FAILED_MESSAGE,
  RECORD_TOO_LONG_MESSAGE,
  RECORD_TOO_SHORT_MESSAGE,
  voiceErrorCopy,
  voiceFailureReasonFor,
} from './voice-native';
import { VoiceError } from './voice';

function fakeAudio(
  overrides: Partial<{
    granted: boolean;
    uri: string | null;
    currentTime: number;
    prepareFails: boolean;
  }> = {},
) {
  const instances: Array<{ stopped: boolean }> = [];
  const options_: unknown[] = [];
  return {
    instances,
    options: options_,
    audio: {
      requestRecordingPermissionsAsync: vi.fn(async () => ({
        granted: overrides.granted ?? true,
      })),
      AudioRecorder: class {
        uri: string | null = overrides.uri ?? 'file:///cache/rec.m4a';
        isRecording = false;
        currentTime = overrides.currentTime ?? 5;
        constructor(readonly options: unknown) {
          options_.push(options);
        }
        getStatus(): { metering: number } {
          return { metering: -30 };
        }
        async prepareToRecordAsync(): Promise<void> {
          if (overrides.prepareFails === true) {
            throw new Error('no mic');
          }
        }
        record(): void {
          this.isRecording = true;
        }
        async stop(): Promise<void> {
          this.isRecording = false;
          instances.push({ stopped: true });
        }
      },
      HIGH_QUALITY: { extension: '.m4a' },
    },
  };
}

describe('voice recorder seam (T-0154 review)', () => {
  it('denies without creating a recorder and reports the denied copy', async () => {
    const fake = fakeAudio({ granted: false });
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async () => {},
      fileReader: async () => ({ size: 120_000 }),
    });
    const result = await recorder.start();
    expect(result).toEqual({ status: 'error', message: MIC_DENIED_MESSAGE });
    expect(fake.instances).toHaveLength(0);
  });

  it('a throwing permission request is a handled mic failure', async () => {
    const fake = fakeAudio({});
    fake.audio.requestRecordingPermissionsAsync = vi.fn(async () => {
      throw new Error('no native module');
    });
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async () => {},
      fileReader: async () => ({ size: 120_000 }),
    });
    // `start()` never throws: the failure is a handled result the button
    // renders as the mic-failed copy (finding 1, round 3).
    const result = await recorder.start();
    expect(result).toEqual({ status: 'error', message: MIC_FAILED_MESSAGE });
    expect(fake.instances).toHaveLength(0);
  });

  it('reads the size through the injected reader (the documented File.size path)', async () => {
    const fake = fakeAudio({ currentTime: 5 });
    const fileReader = vi.fn(async (uri: string) => {
      expect(uri).toBe('file:///cache/rec.m4a');
      return { size: 120_000 };
    });
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async () => {},
      fileReader,
    });
    expect(await recorder.start()).toEqual({ status: 'started' });
    const result = await recorder.stop();
    expect(fileReader).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'recorded',
      recording: {
        uri: 'file:///cache/rec.m4a',
        mimeType: 'audio/mp4',
        size: 120_000,
        durationMs: 5000,
      },
    });
  });

  it('a size-read failure is unknown, never empty', async () => {
    const fake = fakeAudio({ currentTime: 5 });
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async () => {},
      fileReader: async () => {
        throw new Error('unreadable');
      },
    });
    expect(await recorder.start()).toEqual({ status: 'started' });
    const result = await recorder.stop();
    // Behaviour: the stop reports the save-failed copy (the component
    // shows it), not an empty recording and not a silent success.
    expect(result).toEqual({ status: 'error', message: RECORD_FAILED_MESSAGE });
  });

  it('a real zero size stays zero (only a real zero is voice_empty)', async () => {
    const fake = fakeAudio({ currentTime: 5 });
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async () => {},
      fileReader: async () => ({ size: 0 }),
    });
    expect(await recorder.start()).toEqual({ status: 'started' });
    const result = await recorder.stop();
    expect(result).toEqual({
      status: 'recorded',
      recording: {
        uri: 'file:///cache/rec.m4a',
        mimeType: 'audio/mp4',
        size: 0,
        durationMs: 5000,
      },
    });
  });
});

describe('voice recording quality and level (device test 2026-10-03)', () => {
  it('records mono with metering on, and reports a 0..1 level from the dB reading', async () => {
    const fake = fakeAudio({});
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async () => {},
      fileReader: async () => ({ size: 120_000 }),
    });
    await recorder.start();
    expect(fake.options[0]).toMatchObject({ numberOfChannels: 1, isMeteringEnabled: true });
    expect(recorder.currentLevel()).toBeCloseTo(0.5, 5);
    await recorder.stop();
    expect(recorder.currentLevel()).toBe(0);
  });

  it('switches the audio session back to playback once the mic is released', async () => {
    const fake = fakeAudio({});
    const modes: boolean[] = [];
    const recorder = createVoiceRecorder({
      audio: fake.audio,
      setAudioMode: async (mode) => {
        modes.push(mode.allowsRecording);
      },
      fileReader: async () => ({ size: 120_000 }),
    });
    await recorder.start();
    await recorder.stop();
    expect(modes).toEqual([true, false]);
  });
});

describe('voice failure reasons (T-0154 review)', () => {
  it('maps offline to network', () => {
    expect(voiceFailureReasonFor(new Error('x'), true)).toBe('network');
    expect(voiceErrorCopy('network')).toBe('Could not send. Check your connection.');
  });

  it('maps over-limit codes to too_large', () => {
    expect(voiceFailureReasonFor(new VoiceError('voice_too_large', 'x'), false)).toBe('too_large');
    expect(voiceFailureReasonFor(new VoiceError('voice_too_long', 'x'), false)).toBe('too_large');
    expect(voiceErrorCopy('too_large')).toBe('That recording is too long to send.');
  });

  it('maps unreadable codes to unsupported_file', () => {
    expect(voiceFailureReasonFor(new VoiceError('voice_not_audio', 'x'), false)).toBe(
      'unsupported_file',
    );
    expect(voiceFailureReasonFor(new VoiceError('voice_empty', 'x'), false)).toBe(
      'unsupported_file',
    );
    expect(voiceErrorCopy('unsupported_file')).toBe('That recording could not be read.');
  });

  it('maps an upload refusal to upload_refused', () => {
    expect(voiceFailureReasonFor(new VoiceError('upload_failed', 'x'), false)).toBe(
      'upload_refused',
    );
    expect(voiceErrorCopy('upload_refused')).toBe('Could not upload the recording.');
  });

  it('maps conversion failures to server_unavailable and the rest there too', () => {
    expect(voiceFailureReasonFor(new VoiceError('voice_failed', 'x'), false)).toBe(
      'server_unavailable',
    );
    expect(voiceFailureReasonFor(new Error('boom'), false)).toBe('server_unavailable');
    expect(voiceErrorCopy('server_unavailable')).toBe(
      'Could not send the voice message. Try again.',
    );
    expect(voiceErrorCopy('timed_out')).toBe('Sending took too long. Try again.');
  });

  it('documents the recorder refusal copies', () => {
    expect(RECORD_TOO_SHORT_MESSAGE).toContain('Too short');
    expect(RECORD_TOO_LONG_MESSAGE).toContain('too long');
  });
});
