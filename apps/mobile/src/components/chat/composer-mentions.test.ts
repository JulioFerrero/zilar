import { describe, expect, it } from 'vitest';

import {
  backspaceMention,
  caretAfterChange,
  composerBarFor,
  emptyMentionState,
  isSingleCharBackspace,
  mentionCandidates,
  MENTION_MAX_ROWS,
  mentionStateForChange,
  pickMentionMember,
  resetMentionStateForChatKey,
} from './composer-mentions';

const ana = { jid: 'ana@zilar.test', name: 'Ana', handle: 'ana' };
const luis = { jid: 'luis@zilar.test', name: 'Luis' };
const devAi = { jid: 'ai-dev-ai@zilar.test', name: 'Dev AI' };
const all = [ana, luis, devAi];

describe('composer mention helpers (T-0227)', () => {
  it('opens the picker on `@` at the start or after a space', () => {
    const start = mentionStateForChange('', '@', 1, emptyMentionState(), true);
    expect(start.query).toEqual({ start: 0, query: '' });
    const afterSpace = mentionStateForChange('hi @a', 'hi @a', 5, emptyMentionState(), true);
    expect(afterSpace.query).toEqual({ start: 3, query: 'a' });
  });

  it('never opens the picker in DMs (not enabled)', () => {
    const state = mentionStateForChange('', '@', 1, emptyMentionState(), false);
    expect(state.query).toBeUndefined();
    expect(mentionCandidates(all, state)).toEqual([]);
  });

  it('filters members by the query and caps the rows like web', () => {
    expect(MENTION_MAX_ROWS).toBe(6);
    const state = mentionStateForChange('', '@a', 2, emptyMentionState(), true);
    expect(mentionCandidates(all, state)).toEqual([ana, devAi]);
  });

  it('closes the list when the query no longer matches anyone', () => {
    const state = mentionStateForChange('', '@zzz', 4, emptyMentionState(), true);
    expect(mentionCandidates(all, state)).toEqual([]);
  });

  it('picking a member inserts `@handle ` and tracks the mention', () => {
    const picked = pickMentionMember('hi @a', 5, ana, {
      mentions: [],
      query: { start: 3, query: 'a' },
    });
    expect(picked?.text).toBe('hi @ana ');
    expect(picked?.caret).toBe(8);
    expect(picked?.state.mentions).toEqual([
      { jid: 'ana@zilar.test', name: 'Ana', begin: 3, end: 7 },
    ]);
    expect(picked?.state.query).toBeUndefined();
  });

  it('picking a member without a handle inserts `@Name `', () => {
    const picked = pickMentionMember('@l', 2, luis, {
      mentions: [],
      query: { start: 0, query: 'l' },
    });
    expect(picked?.text).toBe('@Luis ');
    expect(picked?.caret).toBe(6);
  });

  it('backspace inside or right after a mention removes the whole token', () => {
    const state = {
      mentions: [{ jid: 'ana@zilar.test', name: 'Ana', begin: 3, end: 7 }],
      query: undefined,
    };
    const removed = backspaceMention('hi @ana!', 7, state, true);
    expect(removed?.text).toBe('hi !');
    expect(removed?.caret).toBe(3);
    expect(removed?.state.mentions).toEqual([]);
  });

  it('backspace elsewhere deletes one character as usual', () => {
    const state = {
      mentions: [{ jid: 'luis@zilar.test', name: 'Luis', begin: 7, end: 12 }],
      query: undefined,
    };
    expect(backspaceMention('hi there @Luis', 2, state, true)).toBeUndefined();
  });

  it('typing retracks the ranges and sending returns the mentions', () => {
    const picked = pickMentionMember('@a', 2, ana, {
      mentions: [],
      query: { start: 0, query: 'a' },
    });
    expect(picked).toBeDefined();
    if (picked === undefined) {
      return;
    }
    const next = mentionStateForChange(picked.text, `${picked.text}!`, 6, picked.state, true);
    expect(next.mentions).toEqual([{ jid: 'ana@zilar.test', name: 'Ana', begin: 0, end: 4 }]);
    expect(next.query).toBeUndefined();
  });

  it('derives the post-change caret from the pre-change selection', () => {
    // Typing `@al`: `onSelectionChange` for the `l` has not fired yet, so the
    // tracked caret still points after `@a` — the filter must use the shifted
    // caret or it lags one keystroke behind.
    expect(caretAfterChange('@a', '@al', 2)).toBe(3);
    expect(
      mentionStateForChange(
        '@a',
        '@al',
        caretAfterChange('@a', '@al', 2),
        {
          mentions: [],
          query: { start: 0, query: 'a' },
        },
        true,
      ).query,
    ).toEqual({ start: 0, query: 'al' });
    // Backspace to `@a` shifts the caret back; an unknown selection falls
    // back to the text end; the caret stays inside the new text.
    expect(caretAfterChange('@al', '@a', 3)).toBe(2);
    expect(caretAfterChange('@a', '@al', undefined)).toBe(3);
    expect(caretAfterChange('a', '', 5)).toBe(0);
  });

  it('a range replace with net −1 is typing, not a backspace (T-0227 M1)', () => {
    // Text `@ana ab` with tracked mention [0,4); selecting `ab` and typing
    // `c` gives `@ana c` (net −1) with a non-collapsed pre-change selection —
    // the mention must be kept, never rebuilt from the old text.
    const state = mentionStateForChange(
      '@ana ab',
      '@ana c',
      6,
      {
        mentions: [{ jid: 'ana@zilar.test', name: 'Ana', begin: 0, end: 4 }],
        query: undefined,
      },
      true,
    );
    expect(state.mentions).toEqual([{ jid: 'ana@zilar.test', name: 'Ana', begin: 0, end: 4 }]);
    expect(isSingleCharBackspace('@ana ab', '@ana c', { start: 5, end: 7 })).toBe(false);
    // A real single-character delete at a collapsed caret is a backspace.
    expect(isSingleCharBackspace('@ana ab', '@ana a', { start: 6, end: 6 })).toBe(true);
    expect(isSingleCharBackspace('@ana ab', '@ana ab', { start: 7, end: 7 })).toBe(false);
    expect(isSingleCharBackspace('@ana ab', '@ana a', { start: 5, end: 7 })).toBe(false);
    expect(isSingleCharBackspace('@ana ab', '@ana a', undefined)).toBe(false);
  });

  it('a legacy group row gets the composer with the picker (T-0227 S1)', () => {
    // Older server, no topics: group chats open the picker, like the topic
    // path. Channels keep their feed bar, DMs keep today's text-only send.
    expect(composerBarFor({ kind: 'group' })).toBe('composer');
    expect(composerBarFor({ kind: 'group', chatKind: 'group' })).toBe('composer');
    expect(composerBarFor({ kind: 'group', chatKind: 'channel' })).toBe('channel-bar');
    expect(composerBarFor({ kind: 'dm' })).toBe('channel-bar');
    // The picker opens in such a chat once members resolve and `@` is typed.
    const members = [
      { jid: 'ana@zilar.test', name: 'Ana', handle: 'ana' },
      { jid: 'luis@zilar.test', name: 'Luis' },
    ];
    const state = mentionStateForChange('', '@a', 2, emptyMentionState(), true);
    expect(mentionCandidates(members, state)).toEqual([
      { jid: 'ana@zilar.test', name: 'Ana', handle: 'ana' },
    ]);
  });

  it('resets mention state on a chat switch but keeps the draft text', () => {
    const tracked = {
      mentions: [{ jid: 'ana@zilar.test', name: 'Ana', begin: 0, end: 4 }],
      query: { start: 0, query: 'a' },
    };
    const switched = resetMentionStateForChatKey('chat-a', 'chat-b', tracked);
    expect(switched.trackedChatKey).toBe('chat-b');
    expect(switched.state).toEqual(emptyMentionState());
    // Same chat (or no key) keeps the tracked mentions.
    expect(resetMentionStateForChatKey('chat-a', 'chat-a', tracked).state).toBe(tracked);
    expect(resetMentionStateForChatKey(undefined, undefined, tracked).state).toBe(tracked);
  });
});
