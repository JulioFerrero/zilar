import { describe, expect, it, vi } from 'vitest';
import { createFakeXmppCore } from './testing';

describe('createFakeXmppCore', () => {
  it('is online and records calls', async () => {
    const core = createFakeXmppCore();
    expect(core.status()).toBe('online');
    await core.sendMessage('ana@zilar.test', 'chat', 'hi');
    expect(core.calls.map((call) => call.method)).toEqual(['sendMessage']);
    expect(core.calls[0]?.args).toEqual(['ana@zilar.test', 'chat', 'hi']);
  });

  it('emits to listeners until they unsubscribe', () => {
    const core = createFakeXmppCore();
    const listener = vi.fn();
    const off = core.on('status', listener);
    core.emit('status', 'offline');
    off();
    core.emit('status', 'online');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('offline');
  });

  it('rejects async methods and throws sync ones when a failure is set', async () => {
    const core = createFakeXmppCore();
    core.failures.connect = new Error('offline');
    core.failures.sendTyping = new Error('typing');
    await expect(core.connect()).rejects.toThrow('offline');
    expect(() => core.sendTyping('a@zilar.test', 'chat', 'composing')).toThrow('typing');
    delete core.failures.connect;
    await expect(core.connect()).resolves.toBeUndefined();
  });

  it('lets an override replace one method', async () => {
    const core = createFakeXmppCore({ sendMessage: async () => ({ id: 'x' }) });
    await expect(core.sendMessage('a', 'chat', 't')).resolves.toEqual({ id: 'x' });
    expect(core.calls).toEqual([]);
  });
});
