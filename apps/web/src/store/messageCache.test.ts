import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_CACHE_KEY,
  clearMessageCache,
  readMessageCache,
  writeMessageCache,
} from './messageCache';
import type { StorageLike } from './realStore';

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

function message(chatId: string, id: string, overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id,
    chatId,
    senderId: 'u-ana',
    senderName: 'Ana',
    text: id,
    createdAt: new Date('2026-10-17T10:00:00.000Z'),
    status: 'sent',
    ...overrides,
  };
}

function chat(id: string): ChatSummary {
  return { id } as ChatSummary;
}

describe('message cache (T-1903)', () => {
  it('round-trips one user and gives another user nothing', () => {
    const storage = memoryStorage();
    const ana = 'ana@zilar.test';
    const bob = 'bob@zilar.test';

    writeMessageCache(storage, 'u-1', [chat(ana), chat(bob)], {
      [ana]: [message(ana, 'm1'), message(ana, 'm2')],
      [bob]: [message(bob, 'm3')],
    });

    const cached = readMessageCache(storage, 'u-1');
    expect(Object.keys(cached)).toEqual([ana, bob]);
    expect(cached[ana]?.map((entry) => entry.id)).toEqual(['m1', 'm2']);
    expect(cached[ana]?.[0]?.createdAt).toBeInstanceOf(Date);
    expect(cached[ana]?.[0]?.createdAt.toISOString()).toBe('2026-10-17T10:00:00.000Z');

    // Another account reads nothing, and the foreign copy is dropped.
    expect(readMessageCache(storage, 'u-2')).toEqual({});
    expect(storage.getItem(MESSAGE_CACHE_KEY)).toBeNull();

    // Sign-out drops the key too.
    writeMessageCache(storage, 'u-1', [chat(ana)], { [ana]: [message(ana, 'm1')] });
    clearMessageCache(storage);
    expect(storage.getItem(MESSAGE_CACHE_KEY)).toBeNull();
  });

  it('never stores unsent messages or preview URLs that only work on this device', () => {
    const storage = memoryStorage();
    const id = 'ana@zilar.test';
    const attachment = {
      kind: 'file' as const,
      url: 'https://files.example/x.pdf',
      name: 'x.pdf',
      size: 10,
      mime: 'application/pdf',
    };

    writeMessageCache(storage, 'u-1', [chat(id)], {
      [id]: [
        message(id, 'local-1', { status: 'sending' }),
        message(id, 'm-sending', { status: 'sending' }),
        message(id, 'm-failed', { status: 'failed', failed: true }),
        message(id, 'm-blob', {
          attachment: { ...attachment, url: 'blob:https://app.example/1' },
        }),
        message(id, 'm-data', {
          image: { url: 'data:image/png;base64,AAAA', width: 1, height: 1 },
        }),
        message(id, 'm-voice', {
          voice: { duration_ms: 1_000, mime: 'audio/webm', waveform: [1], url: 'blob:https://x/2' },
        }),
        message(id, 'm-ok', { attachment }),
      ],
    });

    const list = readMessageCache(storage, 'u-1')[id] ?? [];
    expect(list.map((entry) => entry.id)).toEqual(['m-blob', 'm-data', 'm-voice', 'm-ok']);
    expect(list.find((entry) => entry.id === 'm-blob')?.attachment).toBeUndefined();
    expect(list.find((entry) => entry.id === 'm-data')?.image).toBeUndefined();
    expect(list.find((entry) => entry.id === 'm-voice')?.voice).toBeUndefined();
    expect(list.find((entry) => entry.id === 'm-ok')?.attachment?.url).toBe(
      'https://files.example/x.pdf',
    );
  });

  it('drops the oldest chats when the payload is over the byte cap', () => {
    const storage = memoryStorage();
    const newest = 'new@zilar.test';
    const older = 'old@zilar.test';
    const bulk = (chatId: string, prefix: string): UiMessage[] =>
      Array.from({ length: 50 }, (_, index) =>
        message(chatId, `${prefix}-${index}`, { text: 'a'.repeat(20_000) }),
      );

    writeMessageCache(storage, 'u-1', [chat(newest), chat(older)], {
      [newest]: bulk(newest, 'n'),
      [older]: bulk(older, 'o'),
    });

    const cached = readMessageCache(storage, 'u-1');
    expect(Object.keys(cached)).toEqual([newest]);
    expect(cached[newest]).toHaveLength(50);
    const raw = storage.getItem(MESSAGE_CACHE_KEY) ?? '';
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(1_500_000);
  });
});
