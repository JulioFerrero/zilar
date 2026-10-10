import { describe, expect, it, vi } from 'vitest';
import type { ChatFolder } from '@zilar/chat-core';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import type { Pin } from '@/lib/api';
import { createRealChatStore, type ApiClient, type StorageLike } from './realStore';

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

const ANA = 'ana@zilar.test';

function message(overrides: Partial<ChatMessage> & { chatJid: string; body: string }): ChatMessage {
  return {
    id: `m-${overrides.body}`,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ANA,
    fromResolved: true,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

function pinRow(messageId: string, overrides: Partial<Pin> = {}): Pin {
  return {
    id: `pin-${messageId}`,
    chat: ANA,
    messageId,
    senderName: 'Ana',
    text: 'pinned text',
    kind: 'text',
    pinnedBy: 'u-me',
    pinnedAt: '2026-09-28T11:00:00.000Z',
    ...overrides,
  };
}

function prefRow(
  chatJid: string,
  overrides: { mutedUntil?: string | null; archived?: boolean; pinnedAt?: string | null } = {},
) {
  return {
    chatJid,
    mutedUntil: null as string | null,
    archived: false,
    pinnedAt: null as string | null,
    updatedAt: '2026-09-28T11:00:00.000Z',
    ...overrides,
  };
}

function folder(id: string, position: number): ChatFolder {
  return {
    id,
    name: id,
    icon: 'folder',
    position,
    includeTypes: [],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
  };
}

async function setup(overrides: Partial<ApiClient> = {}) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  xmpp.history[ANA] = [message({ id: 'ana-2', chatJid: ANA, body: 'newest' })];
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
  });
  store.getState().start();
  await flush();
  store.getState().openChat(ANA);
  await flush();
  return { store, api, xmpp };
}

describe('web store pins and prefs (T-0919)', () => {
  it('loads pins when the chat opens', async () => {
    const { store, api } = await setup({ listPins: vi.fn(async () => [pinRow('ana-2')]) });
    expect(api.listPins).toHaveBeenCalledWith(ANA);
    expect(
      store
        .getState()
        .pins(ANA)
        .map((pin) => pin.messageId),
    ).toEqual(['ana-2']);
    expect(store.getState().pinsLoaded(ANA)).toBe(true);
    store.getState().stop();
  });

  it('pins optimistically, keeps the saved row, and reports a pin error', async () => {
    const saved = pinRow('ana-2', { id: 'pin-9' });
    const { store, api } = await setup({
      listPins: vi.fn(async () => []),
      pinMessage: vi.fn(async () => saved),
    });

    await store.getState().pinMessage(ANA, 'ana-2');
    expect(api.pinMessage).toHaveBeenCalledWith({
      chat: ANA,
      messageId: 'ana-2',
      senderName: 'Ana',
      text: 'newest',
      kind: 'text',
    });
    expect(
      store
        .getState()
        .pins(ANA)
        .map((pin) => pin.id),
    ).toEqual(['pin-9']);

    vi.mocked(api.pinMessage).mockRejectedValueOnce(new Error('offline'));
    await expect(store.getState().pinMessage(ANA, 'ana-2')).rejects.toThrow('offline');
    expect(store.getState().pins(ANA)).toEqual([saved]);
    expect(store.getState().pinsError).toEqual({
      chatId: ANA,
      message: 'Could not pin the message. Try again.',
    });
    store.getState().stop();
  });

  it('unpins optimistically and restores the pin with an error on failure', async () => {
    const rows = [pinRow('ana-2')];
    const { store, api } = await setup({
      listPins: vi.fn(async () => rows),
      unpinMessage: vi.fn(async () => {}),
    });
    await store.getState().loadPins(ANA);

    await store.getState().unpinMessage(ANA, rows[0]!.id);
    expect(api.unpinMessage).toHaveBeenCalledWith(rows[0]!.id);
    expect(store.getState().pins(ANA)).toEqual([]);

    vi.mocked(api.unpinMessage).mockRejectedValueOnce(new Error('offline'));
    await store.getState().loadPins(ANA);
    await expect(store.getState().unpinMessage(ANA, rows[0]!.id)).rejects.toThrow('offline');
    expect(store.getState().pins(ANA)).toEqual(rows);
    expect(store.getState().pinsError).toEqual({
      chatId: ANA,
      message: 'Could not unpin the message. Try again.',
    });
    store.getState().stop();
  });

  it('writes a pref optimistically and settles on the saved row', async () => {
    const putChatPref = vi.fn(async () => prefRow(ANA, { mutedUntil: '2026-09-28T13:00:00.000Z' }));
    const { store } = await setup({ putChatPref });

    await store.getState().setMuted(ANA, 'hour');
    expect(putChatPref).toHaveBeenCalledWith(ANA, { mutedUntil: '2026-09-28T13:00:00.000Z' });
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.muted).toBe(true);
    expect(store.getState().chatPrefs[ANA]?.mutedUntil).toBe('2026-09-28T13:00:00.000Z');
    store.getState().stop();
  });

  it('keeps a saved row that landed while a pref write fails (R11)', async () => {
    let release!: (error: Error) => void;
    const gate = new Promise<never>((_resolve, reject) => {
      release = reject;
    });
    const { store, api } = await setup({
      listChatPrefs: vi.fn(async () => []),
      putChatPref: vi.fn(() => gate),
    });

    const pending = store
      .getState()
      .setMuted(ANA, 'hour')
      .catch(() => {});
    await flush();
    // A background refresh lands a saved pin for the same chat mid-flight.
    vi.mocked(api.listChatPrefs).mockResolvedValue([
      prefRow(ANA, { pinnedAt: '2026-09-28T12:30:00.000Z' }),
    ]);
    await store.getState().refreshChatPrefs();
    await flush();

    release(new Error('offline'));
    await pending;

    // Only the failed mute is dropped; the landed saved pin survives.
    const ana = store.getState().chats.find((chat) => chat.id === ANA);
    expect(ana?.pinnedAt).toEqual(new Date('2026-09-28T12:30:00.000Z'));
    expect(ana?.muted).toBe(false);
    store.getState().stop();
  });

  it('sets folders sorted and resets a vanished active id', async () => {
    const { store } = await setup();
    store.getState().setFolders([folder('b', 1), folder('a', 0)]);
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['a', 'b']);

    store.getState().setActiveFolder('a');
    store.getState().setFolders([folder('b', 1)]);
    expect(store.getState().activeFolder).toBe('all');
    store.getState().stop();
  });
});
