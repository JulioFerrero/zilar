import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import {
  advanceStatus,
  clearFailure,
  coreKind,
  FINISHED_TURNS_MAX,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortByRecency,
  sortMessages,
  withoutDraft,
} from './rows';

const chat = (id: string, title = id, at?: number): ChatSummary =>
  ({
    id,
    title,
    ...(at === undefined ? {} : { lastMessage: { createdAt: new Date(at) } }),
  }) as ChatSummary;
const message = (id: string, at: number): UiMessage =>
  ({ id, createdAt: new Date(at) }) as UiMessage;

describe('advanceStatus', () => {
  it('only moves forward and never into or out of failed', () => {
    expect(advanceStatus('sending', 'sent')).toBe('sent');
    expect(advanceStatus('read', 'sent')).toBe('read');
    expect(advanceStatus('sent', 'failed')).toBe('sent');
    expect(advanceStatus('failed', 'read')).toBe('failed');
  });
});

describe('clearFailure', () => {
  it('returns the same object when nothing failed', () => {
    const ok = message('a', 1);
    expect(clearFailure(ok)).toBe(ok);
  });

  it('drops the keys instead of leaving undefined', () => {
    const failed = { ...message('a', 1), failed: true, failureReason: 'too_large' } as UiMessage;
    const cleared = clearFailure(failed);
    expect('failed' in cleared).toBe(false);
    expect('failureReason' in cleared).toBe(false);
  });
});

describe('moveChatToTop', () => {
  it('moves one row to the front and keeps the others in order', () => {
    const list = [chat('a'), chat('b'), chat('c')];
    expect(moveChatToTop(list, 'c').map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns the same list when the row is first or missing', () => {
    const list = [chat('a'), chat('b')];
    expect(moveChatToTop(list, 'a')).toBe(list);
    expect(moveChatToTop(list, 'z')).toBe(list);
  });
});

describe('sorting', () => {
  it('sorts messages by time, then id', () => {
    const sorted = sortMessages([message('b', 5), message('a', 5), message('c', 1)]);
    expect(sorted.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts chats newest first, rows without a message last, ties by title', () => {
    const sorted = sortByRecency([chat('x', 'Zed'), chat('y', 'Amy'), chat('n', 'New', 9)]);
    expect(sorted.map((item) => item.id)).toEqual(['n', 'y', 'x']);
  });
});

describe('coreKind', () => {
  it('maps groups to groupchat and the rest to chat', () => {
    expect(coreKind({ kind: 'group' } as ChatSummary)).toBe('groupchat');
    expect(coreKind({ kind: 'dm' } as ChatSummary)).toBe('chat');
  });
});

describe('rememberFinishedDraftMessage', () => {
  it('keeps at most FINISHED_TURNS_MAX entries, dropping the oldest', () => {
    let record: Record<string, string> = {};
    for (let index = 0; index < FINISHED_TURNS_MAX + 5; index += 1) {
      record = rememberFinishedDraftMessage(record, `m${index}`, `t${index}`);
    }
    const keys = Object.keys(record);
    expect(keys).toHaveLength(FINISHED_TURNS_MAX);
    expect(keys[0]).toBe('m5');
    expect(record[`m${FINISHED_TURNS_MAX + 4}`]).toBe(`t${FINISHED_TURNS_MAX + 4}`);
  });
});

describe('withoutDraft', () => {
  it('returns the same record when the chat has no draft', () => {
    const drafts = { a: 1 };
    expect(withoutDraft(drafts, 'b')).toBe(drafts);
  });

  it('returns a copy without the chat otherwise', () => {
    const drafts = { a: 1, b: 2 };
    expect(withoutDraft(drafts, 'a')).toEqual({ b: 2 });
    expect(drafts).toEqual({ a: 1, b: 2 });
  });
});
