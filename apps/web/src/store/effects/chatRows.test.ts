import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import {
  advanceStatus,
  clearFailure,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortMessages,
} from './chatRows';
import { FINISHED_TURNS_MAX } from './constants';

const chat = (id: string): ChatSummary => ({ id }) as ChatSummary;
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

describe('moveChatToTop', () => {
  it('moves a row up and leaves the list alone when it is already first or missing', () => {
    const list = [chat('a'), chat('b'), chat('c')];
    expect(moveChatToTop(list, 'c').map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(moveChatToTop(list, 'a')).toBe(list);
    expect(moveChatToTop(list, 'z')).toBe(list);
  });
});

describe('clearFailure', () => {
  it('drops the failed flags and returns a clean message as it is', () => {
    const failed = { id: 'm', failed: true, failureReason: 'network' } as UiMessage;
    expect(clearFailure(failed)).toEqual({ id: 'm' });
    const clean = { id: 'm' } as UiMessage;
    expect(clearFailure(clean)).toBe(clean);
  });
});

describe('rememberFinishedDraftMessage', () => {
  it('keeps the newest entries up to the cap', () => {
    let record: Record<string, string> = {};
    for (let index = 0; index < FINISHED_TURNS_MAX + 3; index += 1) {
      record = rememberFinishedDraftMessage(record, `m${index}`, `t${index}`);
    }
    const keys = Object.keys(record);
    expect(keys).toHaveLength(FINISHED_TURNS_MAX);
    expect(keys[0]).toBe('m3');
    expect(keys.at(-1)).toBe(`m${FINISHED_TURNS_MAX + 2}`);
  });
});

describe('sortMessages', () => {
  it('orders by time, then by id', () => {
    const sorted = sortMessages([message('b', 2), message('a', 2), message('c', 1)]);
    expect(sorted.map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  });
});
