import {
  filterMentionMembers,
  findMentionQuery,
  insertMention,
  isMentionOfMe,
  rebaseMentions,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';
import {
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

  const members = isGroup
    ? storeApi
        .getState()
        .groupMembers(chatId)
        .filter((member) => !isMentionOfMe(member.jid, meJid))
    : [];
  const candidates =
    picker === undefined
      ? []
      : filterMentionMembers(members, picker.query).slice(0, MENTION_MAX_ROWS);
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

  const onChange = (next: string, caret: number): void => {
    setMentions((previous) => rebaseMentions(value, next, previous));
    setValue(next);
    setPicker(isGroup ? findMentionQuery(next, caret) : undefined);
    setActiveIndex(0);
    const timestamp = Date.now();
    if (next.trim().length > 0 && timestamp - lastTypingRef.current > 2000) {
      lastTypingRef.current = timestamp;
      storeApi.getState().sendTyping(chatId);
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
