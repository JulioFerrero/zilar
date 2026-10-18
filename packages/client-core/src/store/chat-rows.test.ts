// T-2035: the one chat-list merge shared by web and the phone. It keeps the
// presence fields memory holds (XMPP sends them, the list answer does not),
// merges each row through `mergeUnread`, sorts new rows with the rest and then
// applies the saved prefs.
import type { ChatPrefRow, ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import { mergeChatRows } from './chat-rows';

const NOW = Date.parse('2026-10-18T12:00:00Z');

function preview(chatId: string, id: string, at: string): UiMessage {
  return {
    id,
    chatId,
    senderId: 'ana@zilar.test',
    senderName: 'Ana',
    text: 'hello',
    createdAt: new Date(at),
    status: 'sent',
  };
}

function dm(id: string, lastMessage?: UiMessage): ChatSummary {
  return {
    id,
    kind: 'dm',
    title: id,
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    online: false,
    ...(lastMessage === undefined ? {} : { lastMessage }),
  };
}

function pref(chatJid: string, overrides: Partial<ChatPrefRow> = {}): ChatPrefRow {
  return { chatJid, mutedUntil: null, archived: false, pinnedAt: null, ...overrides };
}

describe('mergeChatRows', () => {
  it('keeps online, lastSeenAt and onlineCount from memory', () => {
    const lastSeenAt = new Date('2026-10-18T11:00:00Z');
    const existing: ChatSummary = {
      ...dm('ana@zilar.test'),
      online: true,
      lastSeenAt,
      onlineCount: 4,
    };
    const fresh = dm('ana@zilar.test');

    const merged = mergeChatRows([existing], [fresh], undefined, [], NOW);

    expect(merged[0]?.online).toBe(true);
    expect(merged[0]?.lastSeenAt).toBe(lastSeenAt);
    expect(merged[0]?.onlineCount).toBe(4);
  });

  it('sorts a new row by recency with the rows already known', () => {
    const older = dm('ana@zilar.test', preview('ana@zilar.test', 'ana-1', '2026-10-01T10:00:00Z'));
    const newer = dm('bo@zilar.test', preview('bo@zilar.test', 'bo-1', '2026-10-02T10:00:00Z'));

    const merged = mergeChatRows([older], [older, newer], undefined, [], NOW);

    expect(merged.map((chat) => chat.id)).toEqual(['bo@zilar.test', 'ana@zilar.test']);
  });

  it('pins, mutes and archives the merged rows from the prefs', () => {
    const rows = [dm('ana@zilar.test'), dm('bo@zilar.test'), dm('cy@zilar.test')];
    const prefs = [
      pref('ana@zilar.test', { pinnedAt: '2026-10-18T09:00:00Z' }),
      pref('bo@zilar.test', { mutedUntil: '2026-12-31T00:00:00Z' }),
      pref('cy@zilar.test', { archived: true }),
    ];

    const merged = mergeChatRows(rows, rows, undefined, prefs, NOW);
    const byId = new Map(merged.map((chat) => [chat.id, chat]));

    expect(byId.get('ana@zilar.test')?.pinnedAt?.toISOString()).toBe('2026-10-18T09:00:00.000Z');
    expect(byId.get('bo@zilar.test')?.muted).toBe(true);
    expect(byId.get('cy@zilar.test')?.archived).toBe(true);
  });
});
