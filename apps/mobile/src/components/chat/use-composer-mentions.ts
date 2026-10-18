import { useState } from 'react';

import {
  backspaceMention,
  caretAfterChange,
  isSingleCharBackspace,
  mentionCandidates,
  mentionStateForChange,
  pickMentionMember,
  resetMentionStateForChatKey,
} from '@/components/chat/composer-mentions';
import type { CaretSelection } from '@/lib/emoji-data';
import type { MentionMember, UiMention } from '@zilar/chat-core';

// The composer's `@` mention tracking: mention ranges with the text, the open query, input change and pick. Edit mode has no picker; a chat switch resets the mentions but keeps the draft.
export function useComposerMentions({
  chatKey,
  mentionMembers,
  editing,
  text,
  setText,
  selection,
  setSelection,
  onTyping,
}: {
  chatKey: string | undefined;
  mentionMembers: MentionMember[] | undefined;
  editing: boolean;
  text: string;
  setText: (text: string) => void;
  selection: CaretSelection | undefined;
  setSelection: (selection: CaretSelection) => void;
  onTyping?: (() => void) | undefined;
}) {
  const [mentions, setMentions] = useState<UiMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | undefined>(
    undefined,
  );
  // A chat switch resets the mentions and query (a picked mention must never leak into another chat) but keeps the draft; seeding from `chatKey` skips the reset on the first render.
  const [trackedChatKey, setTrackedChatKey] = useState<string | undefined>(chatKey);
  if (chatKey !== undefined && trackedChatKey !== chatKey) {
    const reset = resetMentionStateForChatKey(trackedChatKey, chatKey, {
      mentions,
      query: mentionQuery,
    });
    setTrackedChatKey(reset.trackedChatKey);
    setMentions(reset.state.mentions);
    setMentionQuery(reset.state.query);
  }

  // The picker appears only when the screen passes members (groups, never DMs) and never while editing.
  const mentionsEnabled = mentionMembers !== undefined && !editing;
  const candidates =
    mentionsEnabled && mentionQuery !== undefined
      ? mentionCandidates(mentionMembers, { mentions, query: mentionQuery })
      : [];
  const pickerOpen = candidates.length > 0;

  const handleChange = (value: string) => {
    // Deleting one character inside or right after a mention removes the whole token, like web (RN has no reliable backspace signal). Only a single-character delete at a collapsed caret takes that path; any other change retracks the ranges.
    const caret = caretAfterChange(text, value, selection?.start);
    if (mentionsEnabled && mentions.length > 0 && isSingleCharBackspace(text, value, selection)) {
      const removed = backspaceMention(
        text,
        selection?.start ?? 0,
        { mentions, query: mentionQuery },
        true,
      );
      if (removed !== undefined) {
        setText(removed.text);
        setMentions(removed.state.mentions);
        setMentionQuery(removed.state.query);
        setSelection({ start: removed.caret, end: removed.caret });
        return;
      }
    }
    setText(value);
    if (mentionsEnabled) {
      const next = mentionStateForChange(
        text,
        value,
        caret,
        { mentions, query: mentionQuery },
        true,
      );
      setMentions(next.mentions);
      setMentionQuery(next.query);
    }
    if (!editing && value.trim().length > 0) {
      onTyping?.();
    }
  };

  // A picker row replaces the `@query` with the token and puts the caret after it; the field is controlled by `selection`.
  const pickMention = (member: MentionMember) => {
    const caret = selection?.start ?? text.length;
    const picked = pickMentionMember(text, caret, member, { mentions, query: mentionQuery });
    if (picked === undefined) {
      return;
    }
    setText(picked.text);
    setMentions(picked.state.mentions);
    setMentionQuery(undefined);
    setSelection({ start: picked.caret, end: picked.caret });
  };

  const trackEmojiChange = (previousText: string, nextText: string, caret: number) => {
    if (!mentionsEnabled) {
      return;
    }
    const state = mentionStateForChange(
      previousText,
      nextText,
      caret,
      { mentions, query: mentionQuery },
      true,
    );
    setMentions(state.mentions);
    setMentionQuery(state.query);
  };

  const clearMentions = () => {
    setMentions([]);
    setMentionQuery(undefined);
  };

  return {
    mentions,
    candidates,
    pickerOpen,
    handleChange,
    pickMention,
    trackEmojiChange,
    clearMentions,
  };
}
