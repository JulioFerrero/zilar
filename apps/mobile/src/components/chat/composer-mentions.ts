import {
  filterMentionMembers,
  findMentionQuery,
  insertMention,
  rebaseMentions,
  type ChatSummary,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';

/** Up to this many rows show above the composer (the same number as web). */
export const MENTION_MAX_ROWS = 6;

export interface MentionQuery {
  start: number;
  query: string;
}

export interface MentionState {
  mentions: UiMention[];
  query: MentionQuery | undefined;
}

/** The empty mention state (fresh composer, sent message, chat switch). */
export function emptyMentionState(): MentionState {
  return { mentions: [], query: undefined };
}

/**
 * The picker's member rows for the current query (T-0227, like web's
 * `candidates` in `Composer.tsx`): matches filtered and capped, never
 * shown without an open query.
 */
export function mentionCandidates(
  all: readonly MentionMember[],
  state: MentionState,
): MentionMember[] {
  if (state.query === undefined) {
    return [];
  }
  return filterMentionMembers(all, state.query.query).slice(0, MENTION_MAX_ROWS);
}

/** Retracks the mentions and the picker after the text changed. */
export function mentionStateForChange(
  previousText: string,
  nextText: string,
  caret: number,
  state: MentionState,
  enabled: boolean,
): MentionState {
  return {
    mentions: rebaseMentions(previousText, nextText, state.mentions),
    query: enabled ? findMentionQuery(nextText, caret) : undefined,
  };
}

/**
 * The mention-state reset on a chat switch (T-0227 S2): a picked mention
 * must never leak into another chat, while the draft text stays (like web).
 */
export function resetMentionStateForChatKey(
  trackedChatKey: string | undefined,
  chatKey: string | undefined,
  state: MentionState,
): { trackedChatKey: string | undefined; state: MentionState } {
  if (chatKey === undefined || trackedChatKey === chatKey) {
    return { trackedChatKey, state };
  }
  return { trackedChatKey: chatKey, state: emptyMentionState() };
}

/**
 * The caret in the new text after `onChangeText` (T-0227 S1): the tracked
 * `selection` state is the *pre-change* caret (`onSelectionChange` for this
 * keystroke has not fired yet), so shift it by the length delta. Falls back
 * to the end of the previous text when no selection was ever reported.
 * Clamped into the new text.
 */
export function caretAfterChange(
  previousText: string,
  nextText: string,
  previousCaret: number | undefined,
): number {
  const base = previousCaret ?? previousText.length;
  const caret = base + (nextText.length - previousText.length);
  return Math.min(Math.max(caret, 0), nextText.length);
}

/**
 * Which bottom bar a non-topic chat row gets (T-0227 S1): a legacy group row
 * (group chat, not a channel feed) uses the full `Composer` with the `@`
 * picker, like the topic path; channels and DMs keep today's bar. Pure so
 * the screen's branch decision has Vitest coverage.
 */
export function composerBarFor(
  chat: Pick<ChatSummary, 'kind' | 'chatKind' | 'topic'>,
): 'composer' | 'channel-bar' {
  if (chat.kind === 'group' && chat.chatKind !== 'channel') {
    return 'composer';
  }
  return 'channel-bar';
}

/**
 * A real single-character backspace at `caret` before the change (T-0227
 * M1): the selection was collapsed and removing exactly the character at
 * the caret from the old text yields the new text. Any range replace or
 * multi-character edit is normal typing, even when the text shrinks by one.
 */
export function isSingleCharBackspace(
  previousText: string,
  nextText: string,
  selection: { start: number; end: number } | undefined,
): boolean {
  if (selection === undefined || selection.start !== selection.end) {
    return false;
  }
  const caret = selection.start;
  if (caret < 0 || caret >= previousText.length) {
    return false;
  }
  if (nextText.length !== previousText.length - 1) {
    return false;
  }
  return nextText === previousText.slice(0, caret) + previousText.slice(caret + 1);
}

export interface PickedMention {
  text: string;
  caret: number;
  state: MentionState;
}

/** Inserts the picked member's token, like web's `pickMention`. */
export function pickMentionMember(
  text: string,
  caret: number,
  member: MentionMember,
  state: MentionState,
): PickedMention | undefined {
  const inserted = insertMention(text, caret, member);
  if (inserted === undefined) {
    return undefined;
  }
  return {
    text: inserted.text,
    caret: inserted.caret,
    state: {
      mentions: [...rebaseMentions(text, inserted.text, state.mentions), inserted.mention],
      query: undefined,
    },
  };
}

export interface BackspaceMention {
  text: string;
  caret: number;
  state: MentionState;
}

/**
 * Backspace just after or inside a mention removes the whole token, like
 * web's Backspace handler in `Composer.tsx`. Returns `undefined` when the
 * caret is not on a mention (the keypress deletes one character as usual).
 */
export function backspaceMention(
  text: string,
  caret: number,
  state: MentionState,
  enabled: boolean,
): BackspaceMention | undefined {
  const mention = state.mentions.find((item) => caret > item.begin && caret <= item.end);
  if (mention === undefined) {
    return undefined;
  }
  const next = text.slice(0, mention.begin) + text.slice(mention.end);
  return {
    text: next,
    caret: mention.begin,
    state: {
      mentions: rebaseMentions(text, next, state.mentions),
      query: enabled ? findMentionQuery(next, mention.begin) : undefined,
    },
  };
}
