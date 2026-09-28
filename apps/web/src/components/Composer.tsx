import {
  filterMentionMembers,
  findMentionQuery,
  formatDuration,
  insertMention,
  isMentionOfMe,
  rebaseMentions,
  type MentionMember,
  type ReplyRef,
  type UiMention,
} from '@galena/chat-core';
import { ArrowUp, Mic, Paperclip, Smile, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MentionPicker } from './MentionPicker';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { Well } from './ui/well';
import { VOICE_MAX_BYTES, VOICE_MIN_MS, VoiceRecorder, computeWaveform } from '@/lib/voice';
import { useChatStore } from '@/store/ChatStoreProvider';

const LINE_HEIGHT = 22;
const MAX_LINES = 6;
const SLIDE_CANCEL_PX = 60;
const MENTION_MAX_ROWS = 6;
const MENTION_PICKER_ID = 'mention-picker';

interface PressState {
  startX: number;
  cancel: boolean;
  released: boolean;
}

export function Composer({
  chatId,
  replyTo,
  onCancelReply,
}: {
  chatId: string;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
}) {
  const store = useChatStore();
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<UiMention[]>([]);
  const [picker, setPicker] = useState<{ start: number; query: string } | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const pressRef = useRef<PressState | null>(null);
  // Set when a pick or a mention deletion decides where the caret goes; applied
  // after the controlled value has been committed to the textarea.
  const pendingCaretRef = useRef<number | undefined>(undefined);
  const canSend = value.trim().length > 0;
  const title = store.chats.find((chat) => chat.id === chatId)?.title;
  const placeholder = title === undefined ? 'Message' : `Message ${title}`;
  const isGroup = store.chats.find((chat) => chat.id === chatId)?.kind === 'group';
  const meJid = store.me?.jid ?? undefined;
  const members = isGroup
    ? store
        .groupMembers(chatId)
        .filter((member) => !isMentionOfMe(member.jid, store.currentUserId, meJid))
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
  }, [value]);

  const onChange = (next: string, caret: number): void => {
    setMentions((previous) => rebaseMentions(value, next, previous));
    setValue(next);
    setPicker(isGroup ? findMentionQuery(next, caret) : undefined);
    setActiveIndex(0);
    const timestamp = Date.now();
    if (next.trim().length > 0 && timestamp - lastTypingRef.current > 2000) {
      lastTypingRef.current = timestamp;
      store.sendTyping(chatId);
    }
  };

  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    const maxHeight = LINE_HEIGHT * MAX_LINES;
    element.style.height = `${Math.min(Math.max(element.scrollHeight, LINE_HEIGHT), maxHeight)}px`;
  }, [value]);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const timer = window.setInterval(() => {
      const recorder = recorderRef.current;
      if (recorder !== null) {
        setElapsedMs(recorder.durationMs);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [recording]);

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

  const send = (): void => {
    if (!canSend) {
      return;
    }
    store.sendText(chatId, value, {
      ...(replyTo === undefined ? {} : { replyTo }),
      ...(mentions.length === 0 ? {} : { mentions }),
    });
    setValue('');
    setMentions([]);
    setPicker(undefined);
    onCancelReply();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (pickerActive) {
      if (event.key === 'ArrowDown' && candidates.length > 0) {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % candidates.length);
        return;
      }
      if (event.key === 'ArrowUp' && candidates.length > 0) {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length > 0) {
        event.preventDefault();
        const member = candidates[activeRow];
        if (member !== undefined) {
          pickMention(member);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // Keep the key from also closing the chat on a narrow layout.
        event.stopPropagation();
        setPicker(undefined);
        return;
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
        return;
      }
    }

    if (event.key === 'Escape' && replyTo !== undefined) {
      event.preventDefault();
      onCancelReply();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const beginRecording = async (startX: number): Promise<void> => {
    pressRef.current = { startX, cancel: false, released: false };
    setVoiceError(undefined);
    setElapsedMs(0);
    setCancelArmed(false);
    try {
      const recorder = await VoiceRecorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      if (pressRef.current?.released === true) {
        recorder.cancel();
        recorderRef.current = null;
        setRecording(false);
      }
    } catch {
      pressRef.current = null;
      setVoiceError('Microphone unavailable');
    }
  };

  const finishRecording = async (): Promise<void> => {
    const press = pressRef.current;
    const recorder = recorderRef.current;
    pressRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setCancelArmed(false);
    if (recorder === null) {
      return;
    }
    if (press?.cancel === true) {
      recorder.cancel();
      return;
    }

    const recorded = await recorder.stop();
    if (recorded.durationMs < VOICE_MIN_MS) {
      setVoiceError('Hold to record');
      return;
    }
    if (recorded.blob.size > VOICE_MAX_BYTES) {
      setVoiceError('Recording is too long');
      return;
    }
    const waveform = await computeWaveform(recorded.blob);
    store.sendVoice(
      chatId,
      { blob: recorded.blob, durationMs: recorded.durationMs, waveform },
      replyTo === undefined ? undefined : { replyTo },
    );
    onCancelReply();
  };

  const onMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (canSend) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void beginRecording(event.clientX);
  };

  const onMicPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const press = pressRef.current;
    if (press === null) {
      return;
    }
    const cancel = event.clientX < press.startX - SLIDE_CANCEL_PX;
    press.cancel = cancel;
    setCancelArmed(cancel);
  };

  const onMicPointerUp = (): void => {
    if (pressRef.current !== null) {
      pressRef.current.released = true;
    }
    if (recorderRef.current !== null || pressRef.current === null) {
      void finishRecording();
    }
  };

  return (
    <div className="chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5">
      {pickerOpen && (
        <MentionPicker
          id={MENTION_PICKER_ID}
          members={candidates}
          activeIndex={activeRow}
          onSelect={pickMention}
          onHover={setActiveIndex}
        />
      )}
      {replyTo !== undefined && (
        <Well className="mb-2 flex items-stretch overflow-hidden rounded-[10px]">
          <span className="w-[3px] shrink-0 bg-[#333333]" aria-hidden="true" />
          <div className="min-w-0 flex-1 px-2.5 py-1.5">
            <div className="truncate text-[13px] leading-4 font-semibold text-[#d4d4d4]">
              Reply to {replyTo.senderName}
            </div>
            {replyTo.text !== undefined && (
              <div className="truncate text-[13px] leading-4 text-muted-foreground">
                {replyTo.text}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
            className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-surface-raised"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </Well>
      )}
      {voiceError !== undefined && (
        <div className="mb-1 px-1 text-[12px] text-danger" role="alert">
          {voiceError}
        </div>
      )}
      <Well className="flex items-end gap-2 rounded-[14px] p-2">
        {recording ? (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-3 px-1">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
            <span className="shrink-0 text-[15px] tabular-nums">{formatDuration(elapsedMs)}</span>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-muted-foreground">
              {cancelArmed ? 'Release to cancel' : 'Slide to cancel'}
            </span>
          </div>
        ) : (
          <>
            <IconButton aria-label="Attach a file">
              <Paperclip className="size-5" aria-hidden="true" />
            </IconButton>
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(event) => onChange(event.target.value, event.target.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label="Message"
              aria-autocomplete="list"
              aria-expanded={pickerOpen}
              {...(pickerOpen ? { 'aria-controls': MENTION_PICKER_ID } : {})}
              {...(pickerOpen && candidates[activeRow] !== undefined
                ? { 'aria-activedescendant': `mention-option-${candidates[activeRow].jid}` }
                : {})}
              className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[14px] leading-[22px] outline-none placeholder:text-muted-foreground"
            />
            <IconButton aria-label="Insert emoji">
              <Smile className="size-5" aria-hidden="true" />
            </IconButton>
          </>
        )}
        {canSend ? (
          <Button
            type="button"
            aria-label="Send message"
            onClick={send}
            className="size-9 rounded-[10px] p-0"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <IconButton
            aria-label={recording ? 'Cancel voice message' : 'Record voice message'}
            onPointerDown={onMicPointerDown}
            onPointerMove={onMicPointerMove}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerUp}
          >
            <Mic className="size-5" aria-hidden="true" />
          </IconButton>
        )}
      </Well>
    </div>
  );
}
