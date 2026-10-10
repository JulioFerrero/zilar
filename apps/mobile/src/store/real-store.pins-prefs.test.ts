import type { ChatFolder } from '@zilar/chat-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import type { ChatPrefsApi } from '../lib/chat-prefs-api';
import type { PinsApi } from '../lib/pins-api';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApiWithMembers, fakeAppState } from './test-support';
import { flushTasks as flush } from '@/test/wait';

const ANA = 'ana@zilar.test';

function dmEntry(chatJid: string, title: string): ChatEntry {
  return { kind: 'dm', chatJid, title, userId: `u-${chatJid}` };
}

function pinRow(
  overrides: {
    id?: string;
    chat?: string;
    messageId?: string;
    senderName?: string;
    text?: string;
    kind?: 'text' | 'image' | 'file' | 'voice' | 'card';
    pinnedBy?: string;
    pinnedAt?: string;
  } = {},
) {
  return {
    id: 'pin-1',
    chat: ANA,
    messageId: 'm-1',
    senderName: 'Ana',
    text: 'hello',
    kind: 'text' as const,
    pinnedBy: 'u-ana',
    pinnedAt: '2026-09-30T11:00:00Z',
    ...overrides,
  };
}

function fakePins(rows: ReturnType<typeof pinRow>[] = []) {
  return {
    listPins: vi.fn(async (chat: string) => rows.filter((row) => row.chat === chat)),
    pinMessage: vi.fn(
      async (input: {
        chat: string;
        messageId: string;
        senderName: string;
        text: string;
        kind: ReturnType<typeof pinRow>['kind'];
      }) => pinRow({ ...input, id: 'pin-9' }),
    ),
    unpinMessage: vi.fn(async (id: string) => pinRow({ id })),
  } as unknown as PinsApi;
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
    updatedAt: '2026-09-30T11:00:00Z',
    ...overrides,
  };
}

function fakePrefs(rows: ReturnType<typeof prefRow>[] = []) {
  return {
    listChatPrefs: vi.fn(async () => rows.map((row) => ({ ...row }))),
    putChatPref: vi.fn(
      async (
        chatJid: string,
        input: { mutedUntil?: string | null; archived?: boolean; pinned?: boolean },
      ) => {
        const row = prefRow(chatJid);
        if (input.mutedUntil !== undefined) row.mutedUntil = input.mutedUntil;
        if (input.archived !== undefined) row.archived = input.archived;
        if (input.pinned === true) row.pinnedAt = '2026-09-30T12:00:00.000Z';
        return row;
      },
    ),
  } as unknown as ChatPrefsApi;
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

function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApiWithMembers([dmEntry(ANA, 'Ana')]);
  const store = createRealChatStore({
    api,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => createFakeXmppCore(),
    ...deps,
  });
  return { store, api };
}

describe('mobile store pins and prefs (T-0919)', () => {
  it('loads pins when the chat opens', async () => {
    const rows = [pinRow({ chat: ANA })];
    const pins = fakePins(rows);
    const { store } = setup({ pinsApi: pins });
    store.getState().start();
    await flush();

    store.getState().openChat(ANA);
    await flush();
    expect(pins.listPins).toHaveBeenCalledWith(ANA);
    expect(store.getState().pins(ANA)).toEqual(rows);
    store.getState().stop();
  });

  it('pins a loaded message optimistically and keeps the saved row', async () => {
    const core = createFakeXmppCore();
    const pins = fakePins();
    const { store } = setup({ pinsApi: pins, createXmpp: () => core });
    store.getState().start();
    await flush();

    core.emit('message', {
      id: 'm-1',
      kind: 'chat',
      chatJid: ANA,
      fromJid: ANA,
      fromResolved: true,
      timestamp: new Date('2026-09-30T10:00:00Z'),
      outgoing: false,
      body: 'hello',
    });

    await store.getState().pinMessage(ANA, 'm-1');
    expect(pins.pinMessage).toHaveBeenCalledWith({
      chat: ANA,
      messageId: 'm-1',
      senderName: 'Ana',
      text: 'hello',
      kind: 'text',
    });
    expect(store.getState().pinFor(ANA, 'm-1')?.id).toBe('pin-9');
    store.getState().stop();
  });

  it('unpins optimistically and restores the pin on failure', async () => {
    const rows = [pinRow({ chat: ANA, id: 'pin-1' })];
    const pins = fakePins(rows);
    const { store } = setup({ pinsApi: pins });
    store.getState().start();
    await flush();
    store.getState().openChat(ANA);
    await flush();

    await store.getState().unpinMessage(ANA, 'pin-1');
    expect(pins.unpinMessage).toHaveBeenCalledWith('pin-1');
    expect(store.getState().pins(ANA)).toEqual([]);

    vi.mocked(pins.listPins).mockResolvedValueOnce(rows);
    await store.getState().refreshPins(ANA);
    vi.mocked(pins.unpinMessage).mockRejectedValueOnce(new Error('down'));
    await expect(store.getState().unpinMessage(ANA, 'pin-1')).rejects.toThrow();
    expect(store.getState().pins(ANA)).toEqual(rows);
    expect(store.getState().pinsError).toMatchObject({
      chatId: ANA,
      message: 'Could not unpin the message. Try again.',
    });
    store.getState().stop();
  });

  it('reports one pin error text on a failed pin (R13)', async () => {
    const core = createFakeXmppCore();
    const pins = fakePins();
    const { store } = setup({ pinsApi: pins, createXmpp: () => core });
    store.getState().start();
    await flush();

    core.emit('message', {
      id: 'm-1',
      kind: 'chat',
      chatJid: ANA,
      fromJid: ANA,
      fromResolved: true,
      timestamp: new Date('2026-09-30T10:00:00Z'),
      outgoing: false,
      body: 'hello',
    });

    vi.mocked(pins.pinMessage).mockRejectedValueOnce(new Error('down'));
    await expect(store.getState().pinMessage(ANA, 'm-1')).rejects.toThrow();
    expect(store.getState().pins(ANA)).toEqual([]);
    expect(store.getState().pinsError).toMatchObject({
      chatId: ANA,
      message: 'Could not pin the message. Try again.',
    });
    store.getState().stop();
  });

  it('writes a pref optimistically and settles on the saved row', async () => {
    const prefs = fakePrefs();
    const { store } = setup({ chatPrefsApi: prefs });
    store.getState().start();
    await flush();

    await store.getState().setChatPref(ANA, { archived: true });
    expect(prefs.putChatPref).toHaveBeenCalledWith(ANA, { archived: true });
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.archived).toBe(true);
    store.getState().stop();
  });

  it('rolls a failed pref write back to the saved state', async () => {
    const prefs = fakePrefs();
    const { store } = setup({ chatPrefsApi: prefs });
    store.getState().start();
    await flush();

    vi.mocked(prefs.putChatPref).mockRejectedValueOnce(new Error('offline'));
    await expect(store.getState().setChatPref(ANA, { archived: true })).rejects.toThrow();
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.archived).toBeUndefined();
    store.getState().stop();
  });

  it('sets folders sorted, marks them loaded and resets a vanished active id', async () => {
    const { store } = setup();
    store.getState().start();
    await flush();

    store.getState().setFolders([folder('b', 1), folder('a', 0)]);
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(store.getState().foldersLoaded).toBe(true);

    store.getState().setActiveFolder('a');
    store.getState().setFolders([folder('b', 1)]);
    expect(store.getState().activeFolder).toBe('all');
    store.getState().stop();
  });
});
