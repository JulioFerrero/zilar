import { describe, expect, it } from 'vitest';

import { chatsListView, draftEntryKey, emptyChatsText, messagesListView } from './types';

const TURN = '3f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b';

describe('draftEntryKey', () => {
  it('keeps a plain message on its own id', () => {
    expect(draftEntryKey('message-1', {})).toBe('message-1');
  });

  it('keeps the draft key for the message that finished the draft', () => {
    expect(draftEntryKey('message-1', { 'message-1': TURN })).toBe(`draft-${TURN}`);
  });

  it('is stable across the draft-to-message swap', () => {
    // The synthetic draft is keyed `draft-<turnId>`; the final message keeps the
    // same key, so React reuses the bubble and its reveal instead of remounting.
    const draftKey = draftEntryKey(`draft-${TURN}`, {});
    const finalKey = draftEntryKey('message-1', { 'message-1': TURN });
    expect(finalKey).toBe(draftKey);
  });
});

describe('loading view state (T-0067)', () => {
  it('shows the chat-list skeleton only while loading with no rows', () => {
    expect(chatsListView('loading', 0)).toBe('skeleton');
    expect(chatsListView('loaded', 0)).toBe('empty');
    expect(chatsListView('error', 0)).toBe('error');
    expect(chatsListView('loaded', 3)).toBe('list');
  });

  it('keeps the rows a failed or pending refresh already has', () => {
    expect(chatsListView('loading', 3)).toBe('list');
    expect(chatsListView('error', 3)).toBe('list');
  });

  it('shows the message skeleton only while loading with no messages', () => {
    expect(messagesListView('loading', 0)).toBe('skeleton');
    expect(messagesListView('loaded', 0)).toBe('empty');
    expect(messagesListView('error', 0)).toBe('error');
    expect(messagesListView('loaded', 4)).toBe('messages');
  });

  it('shows live messages that arrived while the history was loading', () => {
    expect(messagesListView('loading', 1)).toBe('messages');
    expect(messagesListView('error', 1)).toBe('messages');
  });

  it('tells a genuinely empty list from a filtered one', () => {
    expect(emptyChatsText(0)).toBe('No chats yet');
    expect(emptyChatsText(4)).toBe('No chats found');
  });
});
