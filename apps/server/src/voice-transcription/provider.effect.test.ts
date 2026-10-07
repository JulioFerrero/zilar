// The Effect conversion (T-0492): `transcribeAudio` still exports a Promise,
// but the call now runs on Effect. These tests pin the internals the plain
// tests cannot see — the abort signal handed to the fetch and the timeout
// mapped to `unreachable` — against an injected fetch, never a real endpoint.

import { describe, expect, it, vi } from 'vitest';
import { transcribeAudio, type TranscriptionFetch } from './provider';

const input = {
  baseUrl: 'https://x.example/v1',
  apiKey: null,
  model: 'whisper-1',
  audio: new Uint8Array([1, 2, 3]),
  filename: 'voice.m4a',
  mime: 'audio/mp4',
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transcribeAudio on Effect', () => {
  it('hands the fetch an AbortSignal', async () => {
    let signal: AbortSignal | undefined;
    const fetchFn: TranscriptionFetch = (_url, init) => {
      signal = init.signal;
      return Promise.resolve(okResponse({ text: 'hi' }));
    };
    await transcribeAudio(input, fetchFn);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('times out a stalled provider, aborts its signal and throws unreachable', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const stalled: TranscriptionFetch = (_url, init) => {
        signal = init.signal;
        return new Promise<Response>(() => {});
      };
      const settled = transcribeAudio(input, stalled).then(
        () => null,
        (caught: unknown) => caught,
      );
      await vi.advanceTimersByTimeAsync(60_001);
      const error = await settled;
      expect(error).toMatchObject({ name: 'TranscriptionProviderError', kind: 'unreachable' });
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
