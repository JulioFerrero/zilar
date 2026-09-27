import { describe, expect, it } from 'vitest';

import { groupMessages, type ChatListItem, type MessageListItem } from './grouping';
import type { UiMessage } from './types';

function local(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function message(id: string, senderId: string, createdAt: string): UiMessage {
  return {
    id,
    chatId: 'chat',
    senderId,
    senderName: senderId,
    text: id,
    createdAt,
    status: 'read',
  };
}

function messages(items: ChatListItem[]): MessageListItem[] {
  return items.filter((item): item is MessageListItem => item.type === 'message');
}

describe('groupMessages', () => {
  it('groups the same sender within 5 minutes', () => {
    const items = messages(
      groupMessages([
        message('a', 'ana', local(2026, 9, 27, 12, 0)),
        message('b', 'ana', local(2026, 9, 27, 12, 3)),
      ]),
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ isFirstInGroup: true, isLastInGroup: false });
    expect(items[1]).toMatchObject({ isFirstInGroup: false, isLastInGroup: true });
  });

  it('starts a new group after 5 minutes', () => {
    const items = messages(
      groupMessages([
        message('a', 'ana', local(2026, 9, 27, 12, 0)),
        message('b', 'ana', local(2026, 9, 27, 12, 6)),
      ]),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ isFirstInGroup: true, isLastInGroup: true });
    expect(items[1]).toMatchObject({ isFirstInGroup: true, isLastInGroup: true });
  });

  it('starts a new group when the sender changes', () => {
    const items = messages(
      groupMessages([
        message('a', 'ana', local(2026, 9, 27, 12, 0)),
        message('b', 'luis', local(2026, 9, 27, 12, 1)),
      ]),
    );
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.isFirstInGroup && item.isLastInGroup)).toBe(true);
  });

  it('inserts a date separator for each day', () => {
    const items = groupMessages([
      message('a', 'ana', local(2026, 9, 26, 23, 58)),
      message('b', 'ana', local(2026, 9, 27, 0, 1)),
    ]);
    expect(items.map((item) => item.type)).toEqual(['date', 'message', 'date', 'message']);
    expect(items[0]).toMatchObject({ type: 'date', key: 'date:2026-9-26' });
    expect(items[2]).toMatchObject({ type: 'date', key: 'date:2026-9-27' });
  });

  it('inserts one date separator per day, not per group', () => {
    const items = groupMessages([
      message('a', 'ana', local(2026, 9, 27, 9, 0)),
      message('b', 'luis', local(2026, 9, 27, 10, 0)),
      message('c', 'ana', local(2026, 9, 27, 11, 0)),
    ]);
    expect(items.filter((item) => item.type === 'date')).toHaveLength(1);
  });

  it('never groups messages across a day change', () => {
    const items = messages(
      groupMessages([
        message('a', 'ana', local(2026, 9, 26, 23, 58)),
        message('b', 'ana', local(2026, 9, 27, 0, 1)),
      ]),
    );
    expect(items.every((item) => item.isFirstInGroup && item.isLastInGroup)).toBe(true);
  });

  it('sorts unsorted input', () => {
    const items = messages(
      groupMessages([
        message('b', 'ana', local(2026, 9, 27, 12, 3)),
        message('a', 'ana', local(2026, 9, 27, 12, 0)),
      ]),
    );
    expect(items.map((item) => item.key)).toEqual(['a', 'b']);
  });

  it('returns nothing for no messages', () => {
    expect(groupMessages([])).toEqual([]);
  });
});
