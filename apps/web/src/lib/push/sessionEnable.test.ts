import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { StoreApi } from '@zilar/client-core';
import type { ChatStoreState } from '@/store/store';
import { disableSessionPush, startSessionEnable, type SessionEnableDeps } from './sessionEnable';

type StatusState = { status: string };

function fakeStore(initial: string): {
  api: StoreApi<ChatStoreState>;
  setStatus: (status: string) => void;
} {
  let status = initial;
  const listeners = new Set<(state: StatusState) => void>();
  const api = {
    getState: () => ({ status }) as StatusState as unknown as ChatStoreState,
    subscribe: (listener: (state: StatusState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as StoreApi<ChatStoreState>;
  return {
    api,
    setStatus: (next: string) => {
      status = next;
      for (const listener of listeners) {
        listener({ status });
      }
    },
  };
}

const CONFIG = { vapidPublicKey: 'vapid-key', pushJid: 'push@server.test' };

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('startSessionEnable (T-1152)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('enables once per transition into online with a stored device and granted permission', async () => {
    const { api, setStatus } = fakeStore('offline');
    const setPushPair = vi.fn(async () => undefined);
    const deps: SessionEnableDeps = {
      setPushPair,
      readDevice: () => ({ id: 'device-1', node: 'node-1' }),
      permission: () => 'granted',
      getConfig: async () => CONFIG,
    };
    const stop = startSessionEnable(api, deps);

    setStatus('online');
    setStatus('online');
    await flush();

    setStatus('offline');
    setStatus('connecting');
    setStatus('online');
    await flush();

    expect(setPushPair).toHaveBeenCalledTimes(2);
    expect(setPushPair).toHaveBeenNthCalledWith(1, {
      pushJid: CONFIG.pushJid,
      node: 'node-1',
      enable: true,
    });
    expect(setPushPair).toHaveBeenNthCalledWith(2, {
      pushJid: CONFIG.pushJid,
      node: 'node-1',
      enable: true,
    });
    stop();
  });

  it('disableSessionPush clears the stored device so the next user starts clean', async () => {
    const setPushPair = vi.fn(async () => undefined);
    const clearDevice = vi.fn();

    await Effect.runPromise(
      disableSessionPush({
        setPushPair,
        readDevice: () => ({ id: 'device-1', node: 'node-1' }),
        clearDevice,
        getConfig: async () => CONFIG,
      }),
    );

    expect(setPushPair).toHaveBeenCalledTimes(1);
    expect(setPushPair).toHaveBeenCalledWith({
      pushJid: CONFIG.pushJid,
      node: 'node-1',
      enable: false,
    });
    expect(clearDevice).toHaveBeenCalledTimes(1);

    // A stalled push-config read must not hold sign-out past the timeout,
    // and the handle is still cleared afterwards.
    vi.resetModules();
    const fresh = await import('./sessionEnable');
    const stalledPair = vi.fn(async () => undefined);
    const stalledClear = vi.fn();

    await Effect.runPromise(
      fresh.disableSessionPush({
        setPushPair: stalledPair,
        readDevice: () => ({ id: 'device-1', node: 'node-1' }),
        clearDevice: stalledClear,
        getConfig: () => new Promise<never>(() => undefined),
        timeoutMs: 50,
      }),
    );

    expect(stalledPair).not.toHaveBeenCalled();
    expect(stalledClear).toHaveBeenCalledTimes(1);
  });
});
