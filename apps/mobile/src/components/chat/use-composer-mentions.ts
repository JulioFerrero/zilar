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

/**
 * The composer's `@` mention tracking (T-0227, like web's `mentions` +
 * `picker`): the mention ranges carried with the text, the open query, the
 * input change handler and the pick handler. Edit mode keeps today's
 * behaviour (no picker while editing). A chat switch resets the tracked
 * mentions through `chatKey`; the draft text stays.
 */
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
  // The screen passes `chatKey={chat.id}`: a switch resets the tracked
  // mentions and the open query (a picked mention must never leak into
  // another chat, like web), while the draft text stays. Seeding the initial
  // value from `chatKey` skips the reset on the first render.
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

  // The `@` mention picker (T-0227, like web): only when the screen passes
  // members (groups, never DMs) and never while editing. Sending and the
  // `chatKey` chat switch both reset the tracked mentions.
  const mentionsEnabled = mentionMembers !== undefined && !editing;
  const candidates =
    mentionsEnabled && mentionQuery !== undefined
      ? mentionCandidates(mentionMembers, { mentions, query: mentionQuery })
      : [];
  const pickerOpen = candidates.length > 0;

  const handleChange = (value: string) => {
    // Deleting one character inside or right after a mention removes the
    // whole token, like web's Backspace handler (RN has no reliable
    // `onKeyPress` backspace signal). Only a real single-character delete at
    // a collapsed caret takes the token path (T-0227 M1): a range replace
    // with net −1 is normal typing, or the user's edit would be lost. Any
    // other change retracks the ranges and the picker through the shared
    // helper. The tracked `selection` is the pre-change caret
    // (`onSelectionChange` for this keystroke has not fired yet), so shift
    // it by the length delta to find the post-change caret; tapping a row
    // and emoji insertion set it explicitly.
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

  // Tapping a picker row replaces the `@query` with the token and puts the
  // caret after it, like web's `pickMention`. The native field is controlled
  // by `selection`, so setting it moves the caret on the next render.
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

  // Emoji insertion shifts the caret like any change; the sheet calls this
  // to retrack the ranges (no-op when mentions are off).
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
