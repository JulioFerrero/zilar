import { describe, expect, it, vi } from 'vitest';

import {
  createVoicePort,
  isAlreadyConverted,
  uploadVoice,
  validateRecording,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_MS,
  VOICE_MIME,
  VOICE_MIN_MS,
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
      port.convert({
        uri: 'file:///cache/rec.m4a',
        mimeType: VOICE_MIME,
        size: 0,
        durationMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'voice_empty' });
  });

  it('refuses a sub-1s recording at the send boundary, with no slot or PUT', async () => {
    const requestUploadSlot = vi.fn(async () => ({
      putUrl: 'p',
      getUrl: 'g',
      headers: {},
    }));
    const upload = vi.fn(async () => undefined);
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload },
    });
    await expect(
      port.convert({
        uri: 'file:///cache/rec.m4a',
        mimeType: VOICE_MIME,
        size: 120_000,
        durationMs: 400,
      }),
    ).rejects.toMatchObject({ code: 'voice_too_short' });
    expect(requestUploadSlot).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a 12 MB m4a at the send boundary, with no slot or PUT', async () => {
    const requestUploadSlot = vi.fn(async () => ({
      putUrl: 'p',
      getUrl: 'g',
      headers: {},
    }));
    const upload = vi.fn(async () => undefined);
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload },
    });
    await expect(
      port.convert({
        uri: 'file:///cache/rec.m4a',
        mimeType: VOICE_MIME,
        size: 12 * 1024 * 1024,
        durationMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: 'voice_too_large' });
    expect(requestUploadSlot).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a 6-minute recording at the send boundary, with no slot or PUT', async () => {
    const requestUploadSlot = vi.fn(async () => ({
      putUrl: 'p',
      getUrl: 'g',
      headers: {},
    }));
    const upload = vi.fn(async () => undefined);
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload },
    });
    await expect(
      port.convert({
        uri: 'file:///cache/rec.m4a',
        mimeType: VOICE_MIME,
        size: 120_000,
        durationMs: 6 * 60 * 1000,
      }),
    ).rejects.toMatchObject({ code: 'voice_too_long' });
    expect(requestUploadSlot).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('validateRecording accepts a boundary-exact recording', () => {
    expect(() =>
      validateRecording({ size: VOICE_MAX_BYTES, durationMs: VOICE_MAX_DURATION_MS }),
    ).not.toThrow();
    expect(() => validateRecording({ size: 1, durationMs: VOICE_MIN_MS })).not.toThrow();
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
    const readFile = vi.fn(async (uri: string) => {
      expect(uri).toBe('file:///cache/rec.3gp');
      return bytes;
    });
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:3188/api/voice');
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
      readFile,
    });
    const converted = await port.convert({
      uri: 'file:///cache/rec.3gp',
      mimeType: 'audio/3gpp',
      size: 4,
      durationMs: 9000,
    });
    // The file is read through the device reader (finding 2), never fetch.
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // The client-claimed duration is ignored: the server header wins.
    expect(converted.durationMs).toBe(4321);
    expect(converted.mimeType).toBe(VOICE_MIME);
  });

  it('a file-read failure maps to voice_failed, never to empty', async () => {
    const port = createVoicePort({
      apiUrl: 'http://127.0.0.1:3188',
      getToken: async () => 'tok',
      uploader: { upload: vi.fn(async () => {}) },
      readFile: async () => {
        throw new Error('unreadable');
      },
    });
    await expect(
      port.convert({
        uri: 'file:///cache/rec.3gp',
        mimeType: 'audio/3gpp',
        size: 4,
        durationMs: 9000,
      }),
    ).rejects.toMatchObject({ code: 'voice_failed' });
  });
});
