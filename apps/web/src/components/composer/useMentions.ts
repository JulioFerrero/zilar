import {
  filterMentionMembers,
  findMentionQuery,
  insertMention,
  isAiJid,
  isMentionOfMe,
  mentionInTopic,
  rebaseMentions,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { StoreApi } from '@/store/atomStore';
import type { ChatStoreState } from '@/store/store';

const MENTION_MAX_ROWS = 6;

export interface Mentions {
  mentions: UiMention[];
  setMentions: Dispatch<SetStateAction<UiMention[]>>;
  setPicker: Dispatch<SetStateAction<{ start: number; query: string } | undefined>>;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  /** Set on a pick or a mention deletion; applied after the value commits. */
  pendingCaretRef: RefObject<number | undefined>;
  candidates: MentionMember[];
  pickerActive: boolean;
  pickerOpen: boolean;
  activeRow: number;
  onChange: (next: string, caret: number) => void;
  pickMention: (member: MentionMember) => void;
  /** Handles the picker keys and the backspace-over-a-mention key; true when consumed. */
  onMentionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  reset: () => void;
}

export function useMentions({
  chatId,
  meJid,
  isGroup,
  value,
  setValue,
  storeApi,
  textareaRef,
}: {
  chatId: string;
  meJid: string | undefined;
  isGroup: boolean;
  value: string;
  setValue: (next: string) => void;
  storeApi: StoreApi<ChatStoreState>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}): Mentions {
  const [mentions, setMentions] = useState<UiMention[]>([]);
  const [picker, setPicker] = useState<{ start: number; query: string } | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  // Set when a pick or a mention deletion decides where the caret goes; applied
  // after the controlled value has been committed to the textarea.
  const pendingCaretRef = useRef<number | undefined>(undefined);
  const lastTypingRef = useRef(0);
  // The chat a composing event was last sent for, cleared on every stop, so a
  // paused stanza never goes to a chat we never composed in.
  const typingChatRef = useRef<string | undefined>(undefined);

  const state = storeApi.getState();
  // T-1783: in a topic the @ list offers only who is in it. General, DMs and
  // topics on an older server (no `memberIds`) are not filtered.
  const topic = isGroup ? state.chats.find((entry) => entry.id === chatId)?.topic : undefined;
  const aiIdByJid = new Map<string, string>();
  for (const ai of isGroup ? (state.groupInfo(chatId)?.ais ?? []) : []) {
    aiIdByJid.set(ai.jid, ai.aiId);
  }
  const members = isGroup
    ? state
        .groupMembers(chatId)
        .filter((member) => !isMentionOfMe(member.jid, meJid))
        .filter((member) => topic === undefined || mentionInTopic(topic, member.jid, aiIdByJid))
    : [];
  const matches = picker === undefined ? [] : filterMentionMembers(members, picker.query);
  // T-1844: AIs first like the phone (T-1842), each group in its own order, then the row cap.
  const candidates = [
    ...matches.filter((member) => isAiJid(member.jid)),
    ...matches.filter((member) => !isAiJid(member.jid)),
  ].slice(0, MENTION_MAX_ROWS);
  const pickerActive = isGroup && picker !== undefined;
  const pickerOpen = pickerActive && candidates.length > 0;
  const activeRow = pickerOpen ? Math.min(activeIndex, candidates.length - 1) : 0;

  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === undefined) {
      return;
    }
    pendingCaretRef.current = undefined;
    textareaRef.current?.setSelectionRange(caret, caret);
  }, [value, textareaRef]);

  // Tells the chat the composing line is over: one paused stanza for the chat
  // we last composed in, then the throttle resets so the next keystroke
  // composes again at once.
  const stopTypingNow = useCallback((): void => {
    const sent = typingChatRef.current;
    if (sent === undefined) {
      return;
    }
    typingChatRef.current = undefined;
    lastTypingRef.current = 0;
    storeApi.getState().stopTyping(sent);
  }, [storeApi]);

  // A send clears the composer with `setValue('')` without going through
  // `onChange`, so the value itself is watched: the line stops whenever the
  // text empties, by backspace or by a send.
  useEffect(() => {
    if (value.trim().length > 0) {
      return;
    }
    stopTypingNow();
  }, [value, stopTypingNow]);

  const onChange = (next: string, caret: number): void => {
    setMentions((previous) => rebaseMentions(value, next, previous));
    setValue(next);
    setPicker(isGroup ? findMentionQuery(next, caret) : undefined);
    setActiveIndex(0);
    const timestamp = Date.now();
    if (next.trim().length > 0) {
      if (timestamp - lastTypingRef.current > 2000) {
        lastTypingRef.current = timestamp;
        typingChatRef.current = chatId;
        storeApi.getState().sendTyping(chatId);
      }
    } else {
      stopTypingNow();
    }
  };

  const pickMention = (member: MentionMember): void => {
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const inserted = insertMention(value, caret, member);
    if (inserted === undefined) {
      return;
    }
    setMentions((previous) => [
      ...rebaseMentions(value, inserted.text, previous),
      inserted.mention,
    ]);
    setValue(inserted.text);
    setPicker(undefined);
    setActiveIndex(0);
    pendingCaretRef.current = inserted.caret;
  };

  const onMentionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (pickerActive) {
      if (event.key === 'ArrowDown' && candidates.length > 0) {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % candidates.length);
        return true;
      }
      if (event.key === 'ArrowUp' && candidates.length > 0) {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length > 0) {
        event.preventDefault();
        const member = candidates[activeRow];
        if (member !== undefined) {
          pickMention(member);
        }
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // Keep the key from also closing the chat on a narrow layout.
        event.stopPropagation();
        setPicker(undefined);
        return true;
      }
    }

    // Backspace just after or inside a mention removes the whole `@Name` token.
    if (
      event.key === 'Backspace' &&
      mentions.length > 0 &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const caret = event.currentTarget.selectionStart ?? 0;
      const mention = mentions.find((item) => caret > item.begin && caret <= item.end);
      if (mention !== undefined) {
        event.preventDefault();
        const next = value.slice(0, mention.begin) + value.slice(mention.end);
        setMentions((previous) => rebaseMentions(value, next, previous));
        setValue(next);
        setPicker(isGroup ? findMentionQuery(next, mention.begin) : undefined);
        setActiveIndex(0);
        pendingCaretRef.current = mention.begin;
        return true;
      }
    }
    return false;
  };

  const reset = (): void => {
    setMentions([]);
    setPicker(undefined);
    setActiveIndex(0);
  };

  return {
    mentions,
    setMentions,
    setPicker,
    setActiveIndex,
    pendingCaretRef,
    candidates,
    pickerActive,
    pickerOpen,
    activeRow,
    onChange,
    pickMention,
    onMentionKeyDown,
    reset,
  };
}
