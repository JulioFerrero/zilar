import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { Ports, PortsLive, PortsTest, resolvePorts } from './ports';

const read = Ports.use(Effect.succeed);

describe('Ports', () => {
  it('the live layer keeps what was injected and builds the rest', async () => {
    const now = (): Date => new Date('2026-09-28T12:00:00Z');
    const ports = await Effect.runPromise(read.pipe(Effect.provide(PortsLive({ now }))));
    expect(ports.now).toBe(now);
    expect(ports.appState.current()).toBe('active');
    expect(ports.chatPrefs).toBeUndefined();
    expect(typeof ports.api.getChats).toBe('function');
  });

  it('the voice port is the injected one, else it fails with a network error', async () => {
    const voice = { convert: vi.fn(), upload: vi.fn() };
    expect(resolvePorts({ voice }).voice()).toBe(voice);
    const fallback = resolvePorts({}).voice();
    await expect(
      fallback.convert({ uri: '', mimeType: '', size: 0, durationMs: 1 }),
    ).rejects.toMatchObject({ message: 'Could not reach the server' });
  });

  it('the test layer fails loudly for a port nobody replaced', async () => {
    const ports = await Effect.runPromise(read.pipe(Effect.provide(PortsTest())));
    expect(() => ports.api.getChats()).toThrow('api.getChats is not available');
    expect(ports.now().getTime()).toBe(0);
  });

  it('the test layer takes overrides', async () => {
    const now = (): Date => new Date('2026-09-28T12:00:00Z');
    const ports = await Effect.runPromise(read.pipe(Effect.provide(PortsTest({ now }))));
    expect(ports.now()).toEqual(now());
  });
});
