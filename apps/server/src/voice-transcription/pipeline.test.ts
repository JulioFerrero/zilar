// What Effect makes easy (T-0173): the single-flight map releases its
// entry when a waiter goes away, timeouts map to the fixed typed errors,
// and every typed error maps to its fixed HTTP answer. Vitest runs the
// effects with fakes — no layers, no real network, no real clock beyond
// short sleeps.

import { describe, expect, it, vi } from 'vitest';
import { Duration, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { sqlRuntimeFor, type SqlRuntime } from '../effect/sql';
import { HttpError } from '../errors';
import {
  AudioUnavailable,
  fetchAndTranscribe,
  fetchAndTranscribeAsEffect,
  NotAudio,
  shareInFlight,
  transcriptErrorToHttp,
  TranscriptionFailed,
  VoiceTooLarge,
  VOICE_FETCH_TIMEOUT_MS,
  type FetchAndTranscribeInput,
} from './pipeline';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

const fakeDb = {} as FetchAndTranscribeInput['db'];
const fakeSettings = { baseUrl: 'https://x.example/v1', apiKey: null, model: 'whisper-1' };

// Only `sqlRuntimeFor` is wrapped; every other export is the real module. A
// test can queue a one-off runtime for the next call; unqueued calls pass through.
vi.mock('../effect/sql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../effect/sql')>();
  return { ...actual, sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor) };
});

describe('shareInFlight', () => {
  it('shares one start between concurrent callers', async () => {
    const inFlight = shareInFlight();
    let starts = 0;
    const gate = deferred<string>();
    const start = (): Promise<string> => {
      starts += 1;
      return gate.promise;
    };
    const first = inFlight.run('hash', start);
    const second = inFlight.run('hash', start);
    expect(starts).toBe(1);
    gate.resolve('text');
    await expect(first).resolves.toBe('text');
    await expect(second).resolves.toBe('text');
    expect(inFlight.size()).toBe(0);
  });

  it('a failure releases the entry so the next tap retries', async () => {
    const inFlight = shareInFlight();
    await expect(inFlight.run('hash', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(inFlight.size()).toBe(0);
    await expect(inFlight.run('hash', () => Promise.resolve('retry'))).resolves.toBe('retry');
    expect(inFlight.size()).toBe(0);
  });

  it('an interrupted waiter releases the entry (nothing poisons the next tap)', async () => {
    const inFlight = shareInFlight();
    const gate = deferred<string>();
    let starts = 0;
    const start = (): Promise<string> => {
      starts += 1;
      return gate.promise;
    };
    // One waiter starts the shared work, then goes away (its request is
    // interrupted) while the provider call is still running.
    const waiter = Effect.runPromise(
      Effect.tryPromise(() => inFlight.run('hash', start)),
      { signal: AbortSignal.timeout(20) },
    );
    await expect(waiter).rejects.toThrow();
    // The shared start still finishes for nobody; the entry is cleaned up
    // so the next tap starts fresh instead of hanging on a stale promise.
    gate.resolve('late');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inFlight.size()).toBe(0);
    const fresh = inFlight.run('hash', () => Promise.resolve('fresh'));
    await expect(fresh).resolves.toBe('fresh');
    expect(inFlight.size()).toBe(0);
  });
});

describe('fetchAndTranscribe error mapping', () => {
  it('a fetch rejection answers 502 audio_unavailable, never the cause text', async () => {
    const failing = fetchAndTranscribe({
      db: fakeDb,
      urlHash: 'hash',
      internalUrl: 'https://internal/upload/x',
      settings: fakeSettings,
      fetchAudio: () => Promise.reject(new Error('socket hangup at ejabberd')),
      transcribe: () => Promise.resolve({ text: 'hi', language: null }),
    });
    const error = await failing.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      name: 'HttpError',
      status: 502,
      code: 'audio_unavailable',
    });
    expect(String(error)).not.toContain('socket hangup');
  });

  it('a DB failure rejects with the original error, identical and unwrapped', async () => {
    const dbDown = new Error('db down');
    vi.mocked(sqlRuntimeFor).mockReturnValueOnce({
      runPromise: () => Promise.reject(dbDown),
    } as unknown as SqlRuntime);
    const error = await fetchAndTranscribe({
      db: fakeDb,
      urlHash: 'hash',
      internalUrl: 'https://internal/upload/x',
      settings: fakeSettings,
      fetchAudio: () =>
        Promise.resolve({ body: new Uint8Array([1, 2, 3]), contentType: 'audio/mp4' }),
      transcribe: () => Promise.resolve({ text: 'hi', language: null }),
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBe(dbDown);
  });

  it('an unexpected transcriber throw rejects with the original error, identical', async () => {
    const kablam = new Error('kablam');
    const error = await fetchAndTranscribe({
      db: fakeDb,
      urlHash: 'hash',
      internalUrl: 'https://internal/upload/x',
      settings: fakeSettings,
      fetchAudio: () =>
        Promise.resolve({ body: new Uint8Array([1, 2, 3]), contentType: 'audio/mp4' }),
      transcribe: () => Promise.reject(kablam),
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBe(kablam);
  });
});

describe('transcriptErrorToHttp', () => {
  it('maps each typed error to its fixed HTTP answer', () => {
    const cases: Array<[object, { status: number; code: string }]> = [
      [new AudioUnavailable(), { status: 502, code: 'audio_unavailable' }],
      [new VoiceTooLarge(), { status: 413, code: 'voice_too_large' }],
      [new NotAudio(), { status: 422, code: 'not_audio' }],
      [new TranscriptionFailed(), { status: 502, code: 'transcription_failed' }],
    ];
    for (const [error, expected] of cases) {
      const http = transcriptErrorToHttp(error as AudioUnavailable);
      expect(http).toBeInstanceOf(HttpError);
      expect(http.status).toBe(expected.status);
      expect(http.code).toBe(expected.code);
    }
  });
});

describe('pipeline timeouts', () => {
  const input = {
    db: fakeDb,
    urlHash: 'hash',
    internalUrl: 'https://internal/upload/x',
    settings: fakeSettings,
  } as const;

  it('a fetch that never starts maps to 502 audio_unavailable once its window passes', async () => {
    // The Effect form runs on the TestClock, so the 20 s window is virtual.
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        fetchAndTranscribeAsEffect({
          ...input,
          fetchAudio: () => new Promise<{ body: Uint8Array; contentType: string }>(() => {}),
          transcribe: () => Promise.resolve({ text: 'hi', language: null }),
        }).pipe(Effect.flip),
      );
      yield* TestClock.adjust(Duration.millis(VOICE_FETCH_TIMEOUT_MS + 1));
      return yield* Fiber.join(fiber);
    });
    const error = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
    expect(error).toMatchObject({
      name: 'HttpError',
      status: 502,
      code: 'audio_unavailable',
    });
  });
});
