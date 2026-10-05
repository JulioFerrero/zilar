// The transcription provider port (T-0170): the endpoint builder, the
// silent verification WAV, and the response parsing — all against an
// injected fetch, never a real endpoint.

import { describe, expect, it, vi } from 'vitest';
import { silentVerificationWav, transcribeAudio, transcriptionEndpointFor } from './provider';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transcriptionEndpointFor', () => {
  it('appends the path without doubling slashes', () => {
    expect(transcriptionEndpointFor('https://x.example/v1')).toBe(
      'https://x.example/v1/audio/transcriptions',
    );
    expect(transcriptionEndpointFor('https://x.example/v1/')).toBe(
      'https://x.example/v1/audio/transcriptions',
    );
  });
});

describe('silentVerificationWav', () => {
  it('is a valid 1-second silent WAV header', () => {
    const wav = silentVerificationWav();
    expect(wav.byteLength).toBe(44 + 16_000 * 2);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (offset: number, length: number): string =>
      String.fromCharCode(...wav.slice(offset, offset + length));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(wav.slice(44).every((byte) => byte === 0)).toBe(true);
  });
});

describe('transcribeAudio', () => {
  const input = {
    baseUrl: 'https://x.example/v1',
    apiKey: null,
    model: 'whisper-1',
    audio: new Uint8Array([1, 2, 3]),
    filename: 'voice.m4a',
    mime: 'audio/mp4',
  };

  it('posts multipart with the model and file, and returns text + language', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { text: '  hello  ', language: 'en' }));
    const result = await transcribeAudio(input, fetchFn);
    expect(result).toEqual({ text: 'hello', language: 'en' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { body: FormData }];
    expect(url).toBe('https://x.example/v1/audio/transcriptions');
    expect(init.body.get('model')).toBe('whisper-1');
    expect(init.body.get('file')).toBeInstanceOf(Blob);
  });

  it('sends the bearer key only when one is set', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { text: 'hi' }));
    await transcribeAudio({ ...input, apiKey: 'k' }, fetchFn);
    const [, withKey] = fetchFn.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(withKey.headers['authorization']).toBe('Bearer k');
    fetchFn.mockClear();
    await transcribeAudio(input, fetchFn);
    const [, withoutKey] = fetchFn.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(withoutKey.headers['authorization']).toBeUndefined();
  });

  it('maps rejections vs transport failures to the matching kind', async () => {
    const failing = vi.fn(async () => jsonResponse(401, { error: 'bad key' }));
    await expect(transcribeAudio(input, failing)).rejects.toMatchObject({
      name: 'TranscriptionProviderError',
      kind: 'rejected',
    });
    const serverError = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    await expect(transcribeAudio(input, serverError)).rejects.toMatchObject({
      kind: 'rejected',
    });
    const malformed = vi.fn(async () => jsonResponse(200, { nope: 1 }));
    await expect(transcribeAudio(input, malformed)).rejects.toMatchObject({
      kind: 'rejected',
    });
    const down = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(transcribeAudio(input, down)).rejects.toMatchObject({
      name: 'TranscriptionProviderError',
      kind: 'unreachable',
    });
  });
});
