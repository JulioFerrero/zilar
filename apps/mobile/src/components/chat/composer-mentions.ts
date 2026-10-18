import {
  filterMentionMembers,
  findMentionQuery,
  insertMention,
  isAiJid,
  rebaseMentions,
  type ChatSummary,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';

export const MENTION_MAX_ROWS = 6;

export interface MentionQuery {
  start: number;
  query: string;
}

export interface MentionState {
  mentions: UiMention[];
  query: MentionQuery | undefined;
}

export function emptyMentionState(): MentionState {
  return { mentions: [], query: undefined };
}

/** Matches filtered and capped; AI matches come first so the cap never hides an AI. */
export function mentionCandidates(
  all: readonly MentionMember[],
  state: MentionState,
): MentionMember[] {
  if (state.query === undefined) {
    return [];
  }
  const matches = filterMentionMembers(all, state.query.query);
  const ais = matches.filter((member) => isAiJid(member.jid));
  const people = matches.filter((member) => !isAiJid(member.jid));
  return [...ais, ...people].slice(0, MENTION_MAX_ROWS);
}

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

/** A picked mention must never leak into another chat; the draft text stays. */
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

/** `selection` is the pre-change caret, so shift it by the length delta and clamp. */
export function caretAfterChange(
  previousText: string,
  nextText: string,
  previousCaret: number | undefined,
): number {
  const base = previousCaret ?? previousText.length;
  const caret = base + (nextText.length - previousText.length);
  return Math.min(Math.max(caret, 0), nextText.length);
}

export function composerBarFor(
  chat: Pick<ChatSummary, 'kind' | 'chatKind' | 'topic'>,
): 'composer' | 'channel-bar' {
  if (chat.kind === 'group' && chat.chatKind !== 'channel') {
    return 'composer';
  }
  return 'channel-bar';
}

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
