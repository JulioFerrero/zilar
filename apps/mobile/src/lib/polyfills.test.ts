import { afterEach, describe, expect, it, vi } from 'vitest';

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
