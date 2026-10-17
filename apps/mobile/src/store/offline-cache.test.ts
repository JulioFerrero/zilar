// T-1313: the offline chat cache on the message pipeline. The three cases the
// task names: hydrate then server history (no duplicates, server wins), another
// user's file is ignored, and sign-out removes the file. The file is an
// injected in-memory port, so the real `expo-file-system` is never loaded.
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createRealChatStore, type RealStoreDeps } from './real-store';
import {
  createOfflineCache,
  encodeOfflineCache,
  offlineSnapshot,
  type OfflineCachePort,
} from './offline-cache';
import { fakeApi, fakeAppState } from './test-support';
import { waitFor } from '@/test/wait';

const ANA = 'ana@zilar.test';
const ME = 'u-me';

function cachedMessage(id: string, text: string, createdAt: string): UiMessage {
  return {
    id,
    chatId: ANA,
    senderId: 'u-ana',
    senderName: 'Ana',
    text,
    createdAt: new Date(createdAt),
    status: 'sent',
  };
}

function serverMessage(id: string, text: string): ChatMessage {
  return {
    id,
    chatJid: ANA,
    kind: 'chat',
    fromJid: ANA,
    fromResolved: true,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    body: text,
  };
}

/** An in-memory cache file the store reads and writes. */
function fakePort(initial: string | null = null) {
  let contents = initial;
  return {
    read: vi.fn(async () => contents),
    write: vi.fn(async (value: string) => {
      contents = value;
    }),
    remove: vi.fn(async () => {
      contents = null;
    }),
    stored: () => contents,
  };
}

function seededFile(userId: string, messages: UiMessage[]): string {
  return encodeOfflineCache({ userId, messages: { [ANA]: messages } });
}

function storeWith(deps: Partial<RealStoreDeps>) {
  return createRealChatStore({
    api: fakeApi({
      getChats: vi.fn(async () => [
        { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
      ]),
      getContacts: vi.fn(async () => [{ userId: 'u-ana', name: 'Ana', jid: ANA }]),
    }),
    appState: fakeAppState(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    openDrafts: () => () => {},
    ...deps,
  });
}

function coreWithHistory(messages: ChatMessage[]): XmppCore {
  return createFakeXmppCore({
    loadHistory: vi.fn(async () => ({
      messages,
      complete: false,
      first: messages[0]?.id ?? '',
    })),
  });
}

function chatRow(id: string): ChatSummary {
  return {
    id,
    title: id,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
  };
}

describe('mobile offline chat cache (T-1313)', () => {
  it('keeps 50 chats plus the open one when it falls outside them', () => {
    const chats = Array.from({ length: 60 }, (_, index) => chatRow(`c-${index}`));
    const messages = Object.fromEntries(
      chats.map((chat) => [
        chat.id,
        [cachedMessage(`m-${chat.id}`, chat.id, '2026-09-28T09:00:00Z')],
      ]),
    );

    const snapshot = offlineSnapshot(ME, chats, messages, 'c-55');

    expect(Object.keys(snapshot?.messages ?? {})).toEqual([
      ...chats.slice(0, 50).map((chat) => chat.id),
      'c-55',
    ]);
  });

  it('hydrates, then merges the server history without duplicates (server wins)', async () => {
    const port = fakePort(
      seededFile(ME, [
        cachedMessage('m1', 'cached copy', '2026-09-28T09:00:00Z'),
        cachedMessage('m2', 'only on the phone', '2026-09-28T09:30:00Z'),
      ]),
    );
    const store = storeWith({
      offlineCache: port as unknown as OfflineCachePort,
      sessionUserId: async () => ME,
      createXmpp: () =>
        coreWithHistory([serverMessage('m1', 'server copy'), serverMessage('m3', 'new')]),
    });

    store.getState().start();
    // The file read is async: wait until hydration has painted the cached chat.
    await waitFor(() => store.getState().messages(ANA).length === 2);
    await waitFor(() => store.getState().chatsLoad === 'loaded');

    store.getState().openChat(ANA);
    await waitFor(() => store.getState().historyLoad[ANA] === 'loaded');

    const list = store.getState().messages(ANA);
    const ids = list.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.find((message) => message.id === 'm1')?.text).toBe('server copy');
    expect(ids).toContain('m2');
    expect(ids).toContain('m3');

    store.getState().stop();
  });

  it('never writes local-only or in-flight messages', () => {
    const withLocal = {
      ...cachedMessage('m2', 'kept', '2026-09-28T09:30:00Z'),
      localUri: 'file:///tmp/preview.jpg',
      uploadProgress: 0.5,
      attachment: {
        kind: 'image' as const,
        url: 'file:///tmp/preview.jpg',
        name: 'preview.jpg',
        size: 12,
        mime: 'image/jpeg',
      },
    } as unknown as UiMessage;
    const encoded = encodeOfflineCache({
      userId: ME,
      messages: {
        [ANA]: [
          { ...cachedMessage('local-1', 'sending', '2026-09-28T09:00:00Z'), status: 'sending' },
          { ...cachedMessage('local-2', 'failed', '2026-09-28T09:00:00Z'), status: 'failed' },
          cachedMessage('local-3', 'still local', '2026-09-28T09:00:00Z'),
          withLocal,
        ],
      },
    });

    const parsed = JSON.parse(encoded) as {
      messages: Record<string, Record<string, unknown>[]>;
    };
    const kept = parsed.messages[ANA] ?? [];
    expect(kept.map((message) => message['id'])).toEqual(['m2']);
    expect(kept[0]).not.toHaveProperty('localUri');
    expect(kept[0]).not.toHaveProperty('uploadProgress');
    expect(kept[0]).not.toHaveProperty('attachment');
  });

  it("ignores another user's file", async () => {
    const port = fakePort(
      seededFile('u-other', [cachedMessage('m1', 'not mine', '2026-09-28T09:00:00Z')]),
    );
    const store = storeWith({
      api: fakeApi({
        getMe: vi.fn(async () => {
          throw new Error('offline');
        }),
        getChats: vi.fn(async () => {
          throw new Error('offline');
        }),
      }),
      offlineCache: port as unknown as OfflineCachePort,
      sessionUserId: async () => ME,
    });

    store.getState().start();
    await waitFor(() => port.read.mock.calls.length > 0);
    await waitFor(() => store.getState().chatsLoad === 'error');

    expect(store.getState().chats).toEqual([]);
    expect(store.getState().messagesByChat).toEqual({});

    store.getState().stop();
  });

  it('sign-out removes the file', async () => {
    const port = fakePort(seededFile(ME, [cachedMessage('m1', 'cached', '2026-09-28T09:00:00Z')]));
    const store = storeWith({
      offlineCache: port as unknown as OfflineCachePort,
      sessionUserId: async () => ME,
      createXmpp: () => coreWithHistory([]),
    });

    store.getState().start();
    await waitFor(() => store.getState().messages(ANA).length === 1);
    expect(port.stored()).not.toBeNull();

    store.getState().stop();
    await waitFor(() => port.remove.mock.calls.length > 0);
    expect(port.stored()).toBeNull();
  });

  it('clear() waits for an in-flight write, then removes the file for good', async () => {
    let contents: string | null = null;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port: OfflineCachePort = {
      read: vi.fn(async () => contents),
      write: vi.fn(async (value: string) => {
        await gate;
        contents = value;
      }),
      remove: vi.fn(async () => {
        contents = null;
      }),
    };
    const cache = createOfflineCache(port);

    cache.schedule({
      userId: ME,
      messages: { [ANA]: [cachedMessage('m1', 'one', '2026-09-28T09:00:00Z')] },
    });
    cache.flush();
    const clearing = cache.clear();
    // The write is still in flight: the removal must wait for it.
    expect(port.remove).not.toHaveBeenCalled();

    release();
    await clearing;
    expect(port.remove).toHaveBeenCalledTimes(1);
    expect(contents).toBeNull();

    // A late schedule and flush must not recreate the file.
    cache.schedule({
      userId: ME,
      messages: { [ANA]: [cachedMessage('m2', 'two', '2026-09-28T09:00:00Z')] },
    });
    cache.flush();
    await Promise.resolve();
    expect(port.write).toHaveBeenCalledTimes(1);
    expect(contents).toBeNull();
  });
});
