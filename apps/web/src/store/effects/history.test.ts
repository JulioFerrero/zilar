// T-2035: a failed prefs read during a chat-list refresh must not wipe the
// pins, mutes and archives the last good read put in the store. The phone
// already kept the last rows; web used to replace them with `[]`.
import { describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '@/lib/api';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush, waitFor } from '@/test/wait';
import { createRealChatStore } from '../realStore';
import { type RealStoreDeps } from './ports';
import { type StorageLike } from './portTypes';

const ANA = 'ana@zilar.test';
const NOW = new Date('2026-10-18T12:00:00Z');

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const anaEntry: ChatEntry = { kind: 'dm', chatJid: ANA, title: 'Ana', userId: 'u-ana' };

const pinnedPref = {
  chatJid: ANA,
  mutedUntil: null,
  archived: false,
  pinnedAt: '2026-10-18T09:00:00Z',
  updatedAt: '2026-10-18T09:00:00Z',
};

async function setup(deps: Partial<RealStoreDeps>) {
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api: fakeApi(),
    storage: memoryStorage(),
    now: () => NOW,
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return store;
}

const pinnedAt = (store: Awaited<ReturnType<typeof setup>>): number | undefined =>
  store
    .getState()
    .chats.find((chat) => chat.id === ANA)
    ?.pinnedAt?.getTime();

describe('refreshChats and a failed prefs read', () => {
  it('keeps the pinned row pinned when listChatPrefs fails', async () => {
    const getChats = vi.fn(async () => [anaEntry]);
    const listChatPrefs = vi.fn(async () => [pinnedPref]);
    const store = await setup({ api: fakeApi({ getChats, listChatPrefs }) });

    expect(pinnedAt(store)).toBe(Date.parse('2026-10-18T09:00:00Z'));

    listChatPrefs.mockRejectedValueOnce(new Error('network'));
    store.getState().refreshChats();
    await waitFor(() => {
      if (getChats.mock.calls.length < 2) {
        throw new Error('refresh not run yet');
      }
    });
    await flush();

    expect(pinnedAt(store)).toBe(Date.parse('2026-10-18T09:00:00Z'));
    expect(store.getState().chatPrefs[ANA]?.pinnedAt).toBe('2026-10-18T09:00:00Z');
  });
});
