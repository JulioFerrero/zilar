// T-2019: the shared message-cache codec on the message pipeline. The five
// cases the task names: the editedAt round trip, another user's cache, the
// local-url strip, the byte cap and the open chat; plus the pins and the
// settled-row filter the codec took over from the phone.
import type { Pin } from '@zilar/api-contract';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';

import {
  decodeMessageCache,
  encodeMessageCache,
  selectCachedChats,
  type MessageCacheSnapshot,
} from './message-cache';

const ME = 'u-me';
const ANA = 'ana@zilar.test';
const OPTIONS = { localUrlPrefixes: ['file://', 'data:'] } as const;

const ANA_PIN: Pin = {
  id: 'pin-1',
  chat: ANA,
  messageId: 'm1',
  senderName: 'Ana',
  text: 'pinned copy',
  kind: 'text',
  pinnedBy: 'u-ana',
  pinnedAt: '2026-09-28T09:00:00Z',
};

function message(id: string, overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id,
    chatId: ANA,
    senderId: 'u-ana',
    senderName: 'Ana',
    text: id,
    createdAt: new Date('2026-10-01T09:00:00Z'),
    status: 'sent',
    ...overrides,
  };
}

function snapshot(
  messages: Record<string, UiMessage[]>,
  pins?: Record<string, Pin[]>,
): MessageCacheSnapshot {
  return { userId: ME, messages, ...(pins === undefined ? {} : { pins }) };
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

describe('shared message-cache codec (T-2019)', () => {
  it('round-trips editedAt as a Date', () => {
    const editedAt = new Date('2026-10-01T10:30:00Z');
    const encoded = encodeMessageCache(
      snapshot({ [ANA]: [message('m1', { edited: true, editedAt })] }),
      OPTIONS,
    );

    const decoded = decodeMessageCache(encoded, ME)?.messages[ANA]?.[0];

    expect(decoded?.createdAt).toBeInstanceOf(Date);
    expect(decoded?.editedAt).toBeInstanceOf(Date);
    expect(decoded?.editedAt?.getTime()).toBe(editedAt.getTime());
  });

  it('drops a bad editedAt instead of failing the row', () => {
    const encoded = JSON.stringify({
      version: 1,
      userId: ME,
      messages: {
        [ANA]: [
          {
            id: 'm1',
            chatId: ANA,
            senderId: 'u-ana',
            senderName: 'Ana',
            createdAt: '2026-10-01T09:00:00Z',
            editedAt: 'not a date',
            status: 'sent',
          },
        ],
      },
    });

    const decoded = decodeMessageCache(encoded, ME)?.messages[ANA]?.[0];

    expect(decoded?.createdAt).toBeInstanceOf(Date);
    expect(decoded).not.toHaveProperty('editedAt');
  });

  it("returns null for another user's cache", () => {
    const encoded = encodeMessageCache(snapshot({ [ANA]: [message('m1')] }), OPTIONS);

    expect(decodeMessageCache(encoded, ME)).not.toBeNull();
    expect(decodeMessageCache(encoded, 'u-other')).toBeNull();
  });

  it('returns null for a bad shape or another version', () => {
    expect(decodeMessageCache('not json', ME)).toBeNull();
    expect(
      decodeMessageCache(JSON.stringify({ version: 2, userId: ME, messages: {} }), ME),
    ).toBeNull();
    expect(decodeMessageCache(JSON.stringify({ version: 1, userId: ME }), ME)).toBeNull();
  });

  it('strips local urls and local-only fields but keeps server urls', () => {
    const local = {
      ...message('m1'),
      localUri: 'file:///tmp/preview.jpg',
      uploadProgress: 0.5,
      attachment: {
        kind: 'image',
        url: 'file:///tmp/preview.jpg',
        name: 'preview.jpg',
        size: 12,
        mime: 'image/jpeg',
      },
      image: { url: 'data:image/png;base64,AAAA', width: 1, height: 1 },
      voice: { url: 'file:///tmp/voice.m4a', durationMs: 1000 },
    } as unknown as UiMessage;
    const remote = {
      ...message('m2'),
      attachment: {
        kind: 'file',
        url: 'https://cdn.example/a.pdf',
        name: 'a.pdf',
        size: 12,
        mime: 'application/pdf',
      },
    } as unknown as UiMessage;

    const encoded = encodeMessageCache(snapshot({ [ANA]: [local, remote] }), OPTIONS);
    const parsed = JSON.parse(encoded) as {
      messages: Record<string, Record<string, unknown>[]>;
    };
    const [stripped, kept] = parsed.messages[ANA] ?? [];

    expect(stripped).not.toHaveProperty('localUri');
    expect(stripped).not.toHaveProperty('uploadProgress');
    expect(stripped).not.toHaveProperty('attachment');
    expect(stripped).not.toHaveProperty('image');
    expect(stripped).not.toHaveProperty('voice');
    expect(kept).toHaveProperty('attachment.url', 'https://cdn.example/a.pdf');
  });

  it('never caches in-flight or still-local messages', () => {
    const encoded = encodeMessageCache(
      snapshot({
        [ANA]: [
          message('local-1', { status: 'sending' }),
          message('local-2', { status: 'failed' }),
          message('local-3'),
          message('m4'),
        ],
      }),
      OPTIONS,
    );

    const parsed = JSON.parse(encoded) as {
      messages: Record<string, Record<string, unknown>[]>;
    };

    expect((parsed.messages[ANA] ?? []).map((row) => row['id'])).toEqual(['m4']);
  });

  it('drops the oldest chats first when the byte cap is hit', () => {
    const big = (id: string): UiMessage => message(id, { text: 'x'.repeat(2_000) });
    const newest = big('m1');
    const middle = big('m2');
    const oldest = big('m3');
    const twoChats = encodeMessageCache(snapshot({ 'c-1': [newest], 'c-2': [middle] }), OPTIONS);
    // One byte over the two-chat payload: the third (oldest) chat must go.
    const maxBytes = new TextEncoder().encode(twoChats).length + 1;

    const encoded = encodeMessageCache(
      snapshot({ 'c-1': [newest], 'c-2': [middle], 'c-3': [oldest] }),
      { ...OPTIONS, maxBytes },
    );
    const decoded = decodeMessageCache(encoded, ME);

    expect(Object.keys(decoded?.messages ?? {})).toEqual(['c-1', 'c-2']);
  });

  it('keeps the open chat even when it falls outside the cap', () => {
    const chats = Array.from({ length: 60 }, (_, index) => chatRow(`c-${index}`));
    const firstFifty = chats.slice(0, 50).map((chat) => chat.id);

    expect(selectCachedChats(chats, 'c-55', 50).map((chat) => chat.id)).toEqual([
      ...firstFifty,
      'c-55',
    ]);
    expect(selectCachedChats(chats, 'c-10', 50).map((chat) => chat.id)).toEqual(firstFifty);
    expect(selectCachedChats(chats, null, 50).map((chat) => chat.id)).toEqual(firstFifty);
  });

  it('round-trips the pins, and a bad pin costs only the pins', () => {
    const encoded = encodeMessageCache(
      snapshot({ [ANA]: [message('m1')] }, { [ANA]: [ANA_PIN] }),
      OPTIONS,
    );
    expect(decodeMessageCache(encoded, ME)?.pins).toEqual({ [ANA]: [ANA_PIN] });

    const corrupt = {
      ...(JSON.parse(encoded) as Record<string, unknown>),
      pins: { [ANA]: [{ id: 1 }] },
    };
    const lenient = decodeMessageCache(JSON.stringify(corrupt), ME);
    expect(lenient?.pins).toEqual({});
    expect(lenient?.messages[ANA]?.map((row) => row.id)).toEqual(['m1']);
  });
});
