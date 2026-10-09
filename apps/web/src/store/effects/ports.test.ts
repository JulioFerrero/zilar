import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { Ports, PortsLive, PortsTest, portsLayer, readPorts } from './ports';

describe('Ports', () => {
  it('the live layer fills every port with the real adapters', () => {
    const ports = readPorts(PortsLive);
    expect(typeof ports.api.getChats).toBe('function');
    expect(typeof ports.createXmpp).toBe('function');
    expect(typeof ports.voice.convert).toBe('function');
    expect(typeof ports.attachments.upload).toBe('function');
    expect(typeof ports.openDrafts).toBe('function');
    expect(ports.isVisible()).toBe(true);
  });

  it('a supplied dependency replaces its real counterpart, an explicit null storage stays null', () => {
    const now = (): Date => new Date('2026-09-28T12:00:00Z');
    const ports = readPorts(portsLayer({ storage: null, now }));
    expect(ports.storage).toBeNull();
    expect(ports.now).toBe(now);
  });

  it('the test layer keeps supplied fakes and makes the rest inert', async () => {
    const goToLogin = vi.fn();
    const ports = readPorts(PortsTest({ goToLogin }));
    ports.goToLogin();
    expect(goToLogin).toHaveBeenCalledTimes(1);
    expect(ports.storage).toBeNull();
    await expect(ports.api.getChats()).rejects.toThrow('ApiClient.getChats is not provided');
    expect(() => ports.createXmpp({ service: 'ws://x', domain: 'd', getToken: vi.fn() })).toThrow(
      'createXmpp is not provided',
    );
  });

  it('effects read the ports from the environment', async () => {
    const now = (): Date => new Date('2026-01-02T03:04:05Z');
    const program = Effect.gen(function* () {
      const ports = yield* Ports;
      return ports.now().toISOString();
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(PortsTest({ now }))));
    expect(result).toBe('2026-01-02T03:04:05.000Z');
  });
});
