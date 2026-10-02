import { describe, expect, it, vi } from 'vitest';
import type { UploadSlot } from '@zilar/xmpp-core';
import {
  VOICE_MAX_BYTES,
  VoiceError,
  convertVoice,
  uploadVoice,
  voiceErrorFromGetUserMedia,
  type UploadSlotRequester,
} from './voice';

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('convertVoice', () => {
  it('posts the recording and takes the duration from the server', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'audio/mp4', 'x-zilar-duration-ms': '4200' },
        }),
    );
    const blob = new Blob([new Uint8Array([9, 9])], { type: 'audio/webm' });

    const converted = await convertVoice(blob, fetchFn as unknown as typeof fetch);

    expect(converted.durationMs).toBe(4200);
    expect(converted.audio.type).toBe('audio/mp4');
    expect(await converted.audio.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/voice',
      expect.objectContaining({ method: 'POST', body: blob }),
    );
  });

  it('rejects a recording longer than the size cap without calling the server', async () => {
    const fetchFn = vi.fn();
    const oversized = { size: VOICE_MAX_BYTES + 1, type: 'audio/webm' } as unknown as Blob;

    await expect(convertVoice(oversized, fetchFn as unknown as typeof fetch)).rejects.toMatchObject(
      { code: 'voice_too_large' },
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal for a non-audio upload', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { code: 'voice_not_audio', message: 'not audio' } }, { status: 415 }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' });

    const error = await convertVoice(blob, fetchFn as unknown as typeof fetch).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(VoiceError);
    expect((error as VoiceError).code).toBe('voice_not_audio');
  });

  it('rejects an empty recording before the network', async () => {
    const fetchFn = vi.fn();
    await expect(
      convertVoice(new Blob([]), fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'voice_empty' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('voiceErrorFromGetUserMedia', () => {
  it('tells a blocked microphone from a missing one', () => {
    const blocked = voiceErrorFromGetUserMedia(new DOMException('denied', 'NotAllowedError'));
    expect(blocked).toBeInstanceOf(VoiceError);
    expect(blocked.code).toBe('voice_blocked');
    expect(blocked.message).toContain('site settings');

    const missing = voiceErrorFromGetUserMedia(new DOMException('none', 'NotFoundError'));
    expect(missing.code).toBe('voice_no_microphone');
  });

  it('reports a busy microphone and falls back for unknown failures', () => {
    expect(voiceErrorFromGetUserMedia(new DOMException('busy', 'NotReadableError')).code).toBe(
      'voice_unavailable',
    );
    expect(voiceErrorFromGetUserMedia(new Error('boom')).code).toBe('voice_unavailable');
  });
});

describe('uploadVoice', () => {
  it('requests a slot and PUTs the bytes to it, returning the download url', async () => {
    const slot: UploadSlot = {
      putUrl: 'http://upload.zilar.localhost/upload/abc',
      getUrl: 'http://upload.zilar.localhost/upload/abc/file.m4a',
      headers: { 'x-slot-token': 't0ken' },
    };
    const requester: UploadSlotRequester = {
      requestUploadSlot: vi.fn(async () => slot),
    };
    const fetchFn = vi.fn(async () => new Response(null, { status: 201 }));
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });

    const url = await uploadVoice(requester, audio, fetchFn as unknown as typeof fetch);

    expect(url).toBe(slot.getUrl);
    expect(requester.requestUploadSlot).toHaveBeenCalledWith({
      filename: 'voice.m4a',
      size: audio.size,
      contentType: 'audio/mp4',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      slot.putUrl,
      expect.objectContaining({
        method: 'PUT',
        body: audio,
        headers: expect.objectContaining({ 'x-slot-token': 't0ken' }),
      }),
    );
  });

  it('reports a refused upload', async () => {
    const requester: UploadSlotRequester = {
      requestUploadSlot: async () => ({
        putUrl: 'http://upload/put',
        getUrl: 'http://upload/get',
        headers: {},
      }),
    };
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      uploadVoice(requester, new Blob([new Uint8Array([1])]), fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'upload_failed' });
  });
});
