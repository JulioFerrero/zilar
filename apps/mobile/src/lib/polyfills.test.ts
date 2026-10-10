import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { makeZilarClient, runApi, withFetch } from '@zilar/api-contract';

// polyfills.ts installs its shims at import time, so every test re-imports it
// after it has set up the globals it needs.
async function loadPolyfills(): Promise<typeof import('./polyfills')> {
  vi.resetModules();
  return import('./polyfills');
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('randomUuid (T-0811)', () => {
  it('returns an RFC 4122 v4 UUID', async () => {
    const { randomUuid } = await loadPolyfills();

    expect(randomUuid()).toMatch(UUID_V4);
  });

  it('builds the bytes from crypto.getRandomValues when the runtime has it', async () => {
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(0xab));
    vi.stubGlobal('crypto', { getRandomValues });
    const { randomUuid } = await loadPolyfills();

    expect(randomUuid()).toBe('abababab-abab-4bab-abab-abababababab');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('falls back to Math.random when there is no crypto at all', async () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { randomUuid } = await loadPolyfills();

    expect(randomUuid()).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('polyfill installation (T-0811)', () => {
  it('installs crypto.randomUUID when the runtime lacks it', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => array });
    await loadPolyfills();

    const randomUUID = (globalThis.crypto as { randomUUID?: () => string }).randomUUID;
    expect(typeof randomUUID).toBe('function');
    expect(randomUUID?.()).toMatch(UUID_V4);
  });

  it('keeps the native crypto.randomUUID', async () => {
    const native = globalThis.crypto.randomUUID;
    await loadPolyfills();

    expect(globalThis.crypto.randomUUID).toBe(native);
  });

  it('keeps the native process.nextTick', async () => {
    const native = process.nextTick;
    await loadPolyfills();

    expect(process.nextTick).toBe(native);
  });

  it('installs a process.nextTick that runs the callback later, not inline', async () => {
    vi.stubGlobal('process', {});
    await loadPolyfills();
    const order: string[] = [];
    const nextTick = (globalThis.process as { nextTick: (callback: () => void) => void }).nextTick;

    nextTick(() => order.push('tick'));
    order.push('sync');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(['sync', 'tick']);
  });
});

describe('the UTF-8 TextDecoder polyfill (T-0864)', () => {
  const native = new TextDecoder();
  const samples: ReadonlyArray<ReadonlyArray<number>> = [
    [],
    [0x68, 0x69],
    [0xef, 0xbb, 0xbf, 0x68, 0x69],
    [0xc3, 0xa9, 0xe2, 0x9c, 0x85, 0xf0, 0x9f, 0x98, 0x80],
    [0xff, 0x41, 0x80, 0x42],
    [0xc3, 0x41],
    [0xe2, 0x9c],
    [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf0, 0x9f, 0x98],
    [0xc0, 0xaf, 0xc1, 0xbf],
  ];

  it('decodes like the native TextDecoder, replacing broken sequences', async () => {
    const { Utf8TextDecoder } = await loadPolyfills();
    const decoder = new Utf8TextDecoder();

    for (const bytes of samples) {
      const input = new Uint8Array(bytes);
      expect(decoder.decode(input), bytes.join(',')).toBe(native.decode(input));
    }
  });

  it('reads an ArrayBuffer, a view with an offset, and a long body', async () => {
    const { Utf8TextDecoder } = await loadPolyfills();
    const decoder = new Utf8TextDecoder('utf8');
    const text = `${'Booked for 21:00 ✅ '.repeat(2000)}😀`;
    const bytes = new TextEncoder().encode(text);

    expect(decoder.decode(bytes.buffer)).toBe(text);
    expect(decoder.decode(new DataView(bytes.buffer, 1, 4))).toBe(
      native.decode(bytes.subarray(1, 5)),
    );
    expect(decoder.decode()).toBe('');
    expect(() => new Utf8TextDecoder('latin1')).toThrow(RangeError);
  });

  it('installs itself only when the runtime has no TextDecoder', async () => {
    const nativeDecoder = globalThis.TextDecoder;
    await loadPolyfills();
    expect(globalThis.TextDecoder).toBe(nativeDecoder);

    vi.stubGlobal('TextDecoder', undefined);
    const { Utf8TextDecoder } = await loadPolyfills();
    expect(globalThis.TextDecoder).toBe(Utf8TextDecoder);
  });

  it('lets the contract client decode a response with only the polyfill', async () => {
    vi.stubGlobal('TextDecoder', undefined);
    const { Utf8TextDecoder } = await loadPolyfills();
    expect(globalThis.TextDecoder).toBe(Utf8TextDecoder);
    const decode = vi.spyOn(Utf8TextDecoder.prototype, 'decode');
    const http = Effect.runSync(
      Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
    );
    const respond: typeof fetch = async () =>
      new Response(JSON.stringify({ pins: [] }), { status: 200 });
    const client = Effect.runSync(
      makeZilarClient(http.pipe(withFetch(respond)), { baseUrl: 'http://zilar.test' }),
    );

    await expect(runApi(client.pins.list({ query: { chat: 'ana' } }))).resolves.toEqual({
      pins: [],
    });
    const failed = async () =>
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'Gone ✅' } }), {
        status: 404,
      });
    const failing = Effect.runSync(
      makeZilarClient(http.pipe(withFetch(failed)), { baseUrl: 'http://zilar.test' }),
    );
    await expect(runApi(failing.pins.list({ query: { chat: 'ana' } }))).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Gone ✅',
    });
    expect(decode).toHaveBeenCalled();
  });
});
