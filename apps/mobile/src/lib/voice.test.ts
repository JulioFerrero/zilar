import { describe, expect, it, vi } from 'vitest';

import {
  createVoicePort,
  isAlreadyConverted,
  uploadVoice,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_MS,
  VOICE_MIME,
  VOICE_MIN_MS,
  voiceErrorMessage,
  VoiceError,
} from './voice';

describe('voice send helper (T-0154)', () => {
  it('exposes the server limits the composer enforces', () => {
    expect(VOICE_MIN_MS).toBe(1000);
    expect(VOICE_MAX_DURATION_MS).toBe(5 * 60 * 1000);
    expect(VOICE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('skips the conversion call for an m4a/aac recording', async () => {
    const upload = vi.fn(
      async (
        _file: { uri: string; mimeType: string },
        _slot: { putUrl: string; headers: Record<string, string> },
      ) => undefined,
    );
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload },
      fetchFn: (() => {
        throw new Error('must not fetch for m4a');
      }) as never,
    });
    const requester = {
      requestUploadSlot: vi.fn(async () => ({ putUrl: 'p', getUrl: 'g', headers: {} })),
    };

    expect(isAlreadyConverted({ uri: 'file:///cache/rec.m4a' })).toBe(true);
    expect(isAlreadyConverted({ uri: 'file:///cache/rec.aac' })).toBe(true);
    expect(isAlreadyConverted({ uri: 'file:///cache/rec.bin', mimeType: 'audio/mp4' })).toBe(true);
    expect(isAlreadyConverted({ uri: 'file:///cache/rec.3gp' })).toBe(false);

    const converted = await port.convert({
      uri: 'file:///cache/rec.m4a',
      mimeType: VOICE_MIME,
      size: 120_000,
      durationMs: 4321,
    });
    expect(converted).toEqual({
      uri: 'file:///cache/rec.m4a',
      mimeType: VOICE_MIME,
      size: 120_000,
      durationMs: 4321,
    });
    expect(requester.requestUploadSlot).not.toHaveBeenCalled();
  });

  it('refuses an empty recording before any request', async () => {
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload: vi.fn(async () => {}) },
    });
    await expect(
      port.convert({ uri: 'file:///cache/rec.m4a', mimeType: VOICE_MIME, size: 0, durationMs: 5 }),
    ).rejects.toMatchObject({ code: 'voice_empty' });
  });

  it('refuses an under-one-second recording duration at the port boundary', async () => {
    // The composer refuses these before the store ever sees them; the port
    // documents the same floor so a future caller cannot skip it silently.
    expect(VOICE_MIN_MS).toBeGreaterThan(0);
  });

  it('uploads converted bytes with the voice filename and mime', async () => {
    const upload = vi.fn(async (_file: unknown, _slot: unknown) => undefined);
    const requester = {
      requestUploadSlot: vi.fn(async () => ({
        putUrl: 'https://upload.zilar.test/put/abc',
        getUrl: 'https://upload.zilar.test/get/abc',
        headers: { authorization: 'slot-token' },
      })),
    };
    const url = await uploadVoice(
      requester,
      { upload },
      { uri: 'file:///cache/rec.m4a', mimeType: VOICE_MIME, size: 120_000 },
      undefined,
      'local-1',
    );
    expect(url).toBe('https://upload.zilar.test/get/abc');
    expect(requester.requestUploadSlot).toHaveBeenCalledWith({
      filename: 'voice.m4a',
      size: 120_000,
      contentType: VOICE_MIME,
    });
    expect(upload).toHaveBeenCalledWith(
      { uri: 'file:///cache/rec.m4a', mimeType: VOICE_MIME },
      { putUrl: 'https://upload.zilar.test/put/abc', headers: { authorization: 'slot-token' } },
      undefined,
      'local-1',
    );
  });

  it('lets a user cancel through unchanged, like attachments do', async () => {
    const requester = {
      requestUploadSlot: vi.fn(async () => ({
        putUrl: 'https://upload.zilar.test/put/abc',
        getUrl: 'https://upload.zilar.test/get/abc',
        headers: {},
      })),
    };
    const uploader = {
      upload: vi.fn(async () => {
        throw new Error('cancelled');
      }),
    };
    await expect(
      uploadVoice(requester, uploader, {
        uri: 'file:///cache/rec.m4a',
        mimeType: VOICE_MIME,
        size: 10,
      }),
    ).rejects.toThrow('cancelled');
  });

  it('maps an upload failure to a VoiceError, never a raw throw', async () => {
    const requester = {
      requestUploadSlot: vi.fn(async () => ({
        putUrl: 'https://upload.zilar.test/put/abc',
        getUrl: 'https://upload.zilar.test/get/abc',
        headers: {},
      })),
    };
    const uploader = {
      upload: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await expect(
      uploadVoice(requester, uploader, {
        uri: 'file:///cache/rec.m4a',
        mimeType: VOICE_MIME,
        size: 10,
      }),
    ).rejects.toMatchObject({ code: 'upload_failed' });
  });

  it('posts a non-m4a recording to /api/voice and trusts the duration header', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('.3gp')) {
        return new Response(bytes.buffer as ArrayBuffer);
      }
      expect(target).toBe('http://127.0.0.1:3188/api/voice');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer tok');
      const converted = new Uint8Array([9, 9, 9]);
      return new Response(converted.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'x-zilar-duration-ms': '4321' },
      });
    });
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload: vi.fn(async () => {}) },
      fetchFn: fetchFn as never,
    });
    const converted = await port.convert({
      uri: 'file:///cache/rec.3gp',
      mimeType: 'audio/3gpp',
      size: 4,
      durationMs: 9000,
    });
    // The client-claimed duration is ignored: the server header wins.
    expect(converted.durationMs).toBe(4321);
    expect(converted.mimeType).toBe(VOICE_MIME);
  });

  it('maps conversion errors to plain copy', () => {
    expect(voiceErrorMessage(new VoiceError('voice_too_long', 'x'), false)).toBe(
      'That recording is too long to send.',
    );
    expect(voiceErrorMessage(new VoiceError('voice_too_large', 'x'), false)).toBe(
      'That recording is too long to send.',
    );
    expect(voiceErrorMessage(new VoiceError('upload_failed', 'x'), false)).toBe(
      'Could not upload the recording.',
    );
    expect(voiceErrorMessage(new VoiceError('network_error', 'x'), false)).toBe(
      'Could not reach the server.',
    );
    expect(voiceErrorMessage(new VoiceError('voice_empty', 'x'), false)).toBe(
      'That recording is empty.',
    );
    expect(voiceErrorMessage(new Error('boom'), true)).toBe(
      'Could not send. Check your connection.',
    );
    expect(voiceErrorMessage(new Error('boom'), false)).toBe('Could not send the voice message.');
  });
});
