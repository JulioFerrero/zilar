import { describe, expect, it, vi } from 'vitest';

import { createWhistlePort, type WhistlePort } from './whistle-port';
import {
  consumeTranscribeConsent,
  TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE,
  TRANSCRIBE_EMPTY_MESSAGE,
  TRANSCRIBE_FAILED_MESSAGE,
  TRANSCRIBE_TOO_LONG_MESSAGE,
  TRANSCRIBE_UNAVAILABLE_MESSAGE,
  transcribeCacheName,
  transcribeVoiceNote,
  type TranscribeFileDeps,
  type TranscribePhase,
} from './voice-transcribe-flow';

function port(overrides: Partial<WhistlePort> = {}): WhistlePort {
  return createWhistlePort({
    isAvailable: () => true,
    modelStatus: async () => 'ready',
    downloadModel: async () => {},
    loadModel: async () => {},
    transcribe: async () => ({
      text: 'hello there',
      language: 'en',
      ttftMs: 5,
      decodeTps: 30,
      audioMs: 2000,
      wallMs: 900,
    }),
    ...overrides,
  });
}

function files(overrides: Partial<TranscribeFileDeps> = {}): TranscribeFileDeps {
  return {
    downloadUrl: async () => 'file:///cache/voice-transcribe.m4a',
    deleteCache: async () => {},
    ...overrides,
  };
}

describe('transcribe voice note (T-0179)', () => {
  it('transcribes a local file when the model is ready', async () => {
    const phases: TranscribePhase[] = [];
    const transcribe = vi.fn(async () => ({
      text: 'hello there',
      language: 'en',
      ttftMs: 5,
      decodeTps: 30,
      audioMs: 2000,
      wallMs: 900,
    }));
    const result = await transcribeVoiceNote({
      port: port({ transcribe }),
      source: { localUri: 'file:///cache/rec.m4a' },
      audioMs: 2000,
      onPhase: (phase) => phases.push(phase),
      files: files(),
    });
    expect(result).toMatchObject({ status: 'done' });
    expect(transcribe).toHaveBeenCalledWith(
      'file:///cache/rec.m4a',
      expect.objectContaining({ audioMs: 2000 }),
    );
    expect(phases).toEqual([{ kind: 'transcribing' }]);
  });

  it('asks to confirm, downloads and loads when the model is missing', async () => {
    const phases: TranscribePhase[] = [];
    const seen: number[] = [];
    const confirmDownload = vi.fn(async () => true);
    const downloadModel = vi.fn(async (onProgress?: (fraction: number) => void) => {
      onProgress?.(0.5);
      onProgress?.(1);
    });
    const loadModel = vi.fn(async () => {});
    const result = await transcribeVoiceNote({
      port: port({ modelStatus: async () => 'missing', downloadModel, loadModel }),
      source: { localUri: 'file:///cache/rec.m4a' },
      onPhase: (phase) => phases.push(phase),
      confirmDownload,
      files: files(),
    });
    expect(result).toMatchObject({ status: 'done' });
    expect(confirmDownload).toHaveBeenCalledTimes(1);
    expect(downloadModel).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    expect(phases).toEqual([
      { kind: 'downloading', fraction: 0.5 },
      { kind: 'downloading', fraction: 1 },
      { kind: 'loading' },
      { kind: 'transcribing' },
    ]);
  });

  it('a declined confirm stops with cancelled and downloads nothing', async () => {
    const downloadModel = vi.fn(async () => {});
    const result = await transcribeVoiceNote({
      port: port({ modelStatus: async () => 'missing', downloadModel }),
      source: { localUri: 'file:///cache/rec.m4a' },
      confirmDownload: async () => false,
      files: files(),
    });
    expect(result).toEqual({ status: 'cancelled' });
    expect(downloadModel).not.toHaveBeenCalled();
  });

  it('reports unavailable when the engine is missing', async () => {
    const result = await transcribeVoiceNote({
      port: port({ isAvailable: () => false }),
      source: { localUri: 'file:///cache/rec.m4a' },
      files: files(),
    });
    expect(result).toEqual({ status: 'error', message: TRANSCRIBE_UNAVAILABLE_MESSAGE });
  });

  it('an empty text is the nothing-heard error', async () => {
    const result = await transcribeVoiceNote({
      port: port({
        transcribe: async () => ({
          text: '   ',
          language: '',
          ttftMs: 1,
          decodeTps: 0,
          audioMs: 500,
          wallMs: 100,
        }),
      }),
      source: { localUri: 'file:///cache/rec.m4a' },
      files: files(),
    });
    expect(result).toEqual({ status: 'error', message: TRANSCRIBE_EMPTY_MESSAGE });
  });

  it('maps native error codes to short user messages', async () => {
    const cases: Array<[string, string]> = [
      ['too_long', TRANSCRIBE_TOO_LONG_MESSAGE],
      ['download_failed', TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE],
      ['bad_checksum', TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE],
      ['unavailable', TRANSCRIBE_UNAVAILABLE_MESSAGE],
      ['transcribe_failed', TRANSCRIBE_FAILED_MESSAGE],
    ];
    for (const [code, message] of cases) {
      const result = await transcribeVoiceNote({
        port: port({
          transcribe: async () => {
            throw Object.assign(new Error(code), { code });
          },
        }),
        source: { localUri: 'file:///cache/rec.m4a' },
        files: files(),
      });
      expect(result).toEqual({ status: 'error', message });
    }
  });

  it('downloads a served URL with headers and deletes the cache on success', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
    const deleted: string[] = [];
    const transcribe = vi.fn(async () => ({
      text: 'hello there',
      language: 'en',
      ttftMs: 5,
      decodeTps: 30,
      audioMs: 2000,
      wallMs: 900,
    }));
    const result = await transcribeVoiceNote({
      port: port({ transcribe }),
      source: {
        url: 'https://api.zilar.test/voice.m4a',
        headers: { authorization: 'Bearer token' },
      },
      files: files({
        downloadUrl: async (url, headers) => {
          seen.push({ url, headers });
          return 'file:///cache/voice-transcribe.m4a';
        },
        deleteCache: async (uri) => {
          deleted.push(uri);
        },
      }),
    });
    expect(result).toMatchObject({ status: 'done' });
    expect(seen).toEqual([
      { url: 'https://api.zilar.test/voice.m4a', headers: { authorization: 'Bearer token' } },
    ]);
    expect(transcribe).toHaveBeenCalledWith(
      'file:///cache/voice-transcribe.m4a',
      expect.anything(),
    );
    expect(deleted).toEqual(['file:///cache/voice-transcribe.m4a']);
  });

  it('deletes the cache when the transcription fails', async () => {
    const deleted: string[] = [];
    const result = await transcribeVoiceNote({
      port: port({
        transcribe: async () => {
          throw Object.assign(new Error('failed'), { code: 'transcribe_failed' });
        },
      }),
      source: { url: 'https://api.zilar.test/voice.m4a' },
      files: files({
        downloadUrl: async () => 'file:///cache/voice-transcribe.m4a',
        deleteCache: async (uri) => {
          deleted.push(uri);
        },
      }),
    });
    expect(result).toEqual({ status: 'error', message: TRANSCRIBE_FAILED_MESSAGE });
    expect(deleted).toEqual(['file:///cache/voice-transcribe.m4a']);
  });

  it('a download failure is the generic error', async () => {
    const result = await transcribeVoiceNote({
      port: port(),
      source: { url: 'https://api.zilar.test/voice.m4a' },
      files: files({
        downloadUrl: async () => {
          throw new Error('no network in tests');
        },
      }),
    });
    expect(result).toEqual({ status: 'error', message: TRANSCRIBE_FAILED_MESSAGE });
  });

  it('the cache name is a safe file name', () => {
    expect(transcribeCacheName('m-1')).toBe('voice-transcribe-m-1.m4a');
    expect(transcribeCacheName('../../x')).toBe('voice-transcribe-______x.m4a');
    expect(transcribeCacheName('')).toBe('voice-transcribe-note.m4a');
  });
});

describe('transcribe consent gate (T-0179, round 1)', () => {
  it('a fresh yes downloads once and consumes it', async () => {
    const downloadModel = vi.fn(async () => {});
    const result = await transcribeVoiceNote({
      port: port({ modelStatus: async () => 'missing', downloadModel }),
      source: { localUri: 'file:///cache/rec.m4a' },
      confirmDownload: () =>
        Promise.resolve(consumeTranscribeConsent({ confirmed: true }, () => {})),
      files: files(),
    });
    expect(result).toMatchObject({ status: 'done' });
    expect(downloadModel).toHaveBeenCalledTimes(1);
  });

  it('a stale yes re-opens the sheet and downloads nothing', async () => {
    const downloadModel = vi.fn(async () => {});
    const consent = { confirmed: true };
    let reopened = 0;
    const first = await transcribeVoiceNote({
      port: port({ modelStatus: async () => 'missing', downloadModel }),
      source: { localUri: 'file:///cache/rec.m4a' },
      confirmDownload: () =>
        Promise.resolve(
          consumeTranscribeConsent(consent, () => {
            reopened += 1;
          }),
        ),
      files: files(),
    });
    expect(first).toMatchObject({ status: 'done' });
    // The model still reports missing after the user confirmed once: the
    // same yes must not download again — the sheet re-opens instead.
    const second = await transcribeVoiceNote({
      port: port({ modelStatus: async () => 'missing', downloadModel }),
      source: { localUri: 'file:///cache/rec.m4a' },
      confirmDownload: () =>
        Promise.resolve(
          consumeTranscribeConsent(consent, () => {
            reopened += 1;
          }),
        ),
      files: files(),
    });
    expect(second).toEqual({ status: 'cancelled' });
    expect(reopened).toBe(1);
    expect(downloadModel).toHaveBeenCalledTimes(1);
  });
});
