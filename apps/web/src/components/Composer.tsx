import {
  canEditMessage,
  filterMentionMembers,
  findMentionQuery,
  formatDuration,
  insertMention,
  isMentionOfMe,
  rebaseMentions,
  type MentionMember,
  type ReplyRef,
  type UiMention,
} from '@zilar/chat-core';
import { Data, Effect, Fiber, Schedule } from 'effect';
import { ArrowUp, Mic, Paperclip, Send, Smile, Trash2, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AttachmentPreview } from './AttachmentPreview';
import { EditBar } from './EditBar';
import { MentionPicker } from './MentionPicker';
import { StickerPanel, type StickerChoice } from './StickerPanel';
import type { GifChoice } from './GifPanel';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { Well } from './ui/well';
import {
  MAX_ATTACHMENT_BYTES,
  classify,
  gifBlobType,
  objectUrlFor,
  type PendingAttachment,
} from '@/lib/attachments';
import {
  VOICE_MAX_BYTES,
  VOICE_MIN_MS,
  VoiceError,
  VoiceRecorder,
  computeWaveform,
} from '@/lib/voice';
import { useChatStore } from '@/store/ChatStoreProvider';

const LINE_HEIGHT = 22;
const MAX_LINES = 6;
const SLIDE_CANCEL_PX = 60;
/** A press held past this point is a hold-to-send; a shorter press clicks over to toggle mode. */
const HOLD_MS = 400;
const MENTION_MAX_ROWS = 6;
const MENTION_PICKER_ID = 'mention-picker';

interface PressState {
  /** Client X where the press began, for the slide-to-cancel gesture. */
  startX: number;
  slidToCancel: boolean;
  /** Set on pointer-up when the recorder has not started yet. */
  released: boolean;
  /** Set once the 400 ms hold timer fires. */
  hold: boolean;
  /** Marks a press held past 400 ms as hold-to-send; interrupted on release. */
  holdTimer: Fiber.Fiber<void> | undefined;
}

/** A step of the voice or GIF flow failed; `message` is the fixed sentence shown inline. */
class ComposerFailure extends Data.TaggedError('ComposerFailure')<{
  readonly message: string;
}> {}

const GIF_LOAD_FAILED = 'Could not load that GIF. Try another.';
const VOICE_SAVE_FAILED = 'Could not save the recording, try again';

/** Runs `effect` at once and in the background; the caller never waits for it. */
const fork = (effect: Effect.Effect<void>): void => {
  Effect.runFork(effect);
};

/** The old `clearTimeout` / `clearInterval`: stops a forked timer fiber. */
const stopTimer = (timer: Fiber.Fiber<unknown, unknown>): void => {
  fork(Fiber.interrupt(timer));
};

export function Composer({
  chatId,
  replyTo,
  onCancelReply,
  onOpenStickersSettings,
}: {
  chatId: string;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
  /** Opens Settings → Stickers (the panel's "+" tab and Manage link). */
  onOpenStickersSettings?: (() => void) | undefined;
}) {
  const store = useChatStore();
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<UiMention[]>([]);
  const [picker, setPicker] = useState<{ start: number; query: string } | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  // The chat the tracked mentions belong to. Kept in state so a chat switch can
  // reset them during render (React's "adjust state when a prop changes").
  const [trackedChatId, setTrackedChatId] = useState(chatId);
  const [recording, setRecording] = useState(false);
  /** Click/tap mode: the recording keeps running until Send or Cancel. */
  const [locked, setLocked] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>(undefined);
  const [attachment, setAttachment] = useState<PendingAttachment | undefined>(undefined);
  const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);
  const [stickerOpen, setStickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The sticker toggle button plus the panel: a pointer-down outside this
  // wrapper closes the panel (the panel itself is viewport-fixed, so the
  // Composer subtree cannot contain it).
  const stickerWrapRef = useRef<HTMLSpanElement>(null);
  const lastTypingRef = useRef(0);
  // Leaving the chat or unmounting while recording stops the microphone
  // tracks (the browser's recording indicator must go off) and discards the
  // recording. The recorder cancels itself; the guards below ignore its
  // late `start()` promise if it resolves afterwards.
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const recordingRef = useRef(false);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  // The document pointer listeners below are registered once, so every
  // callback they reach reads the reply through this ref instead of a
  // stale mount-time closure.
  const replyRef = useRef(replyTo);
  replyRef.current = replyTo;

  // The picker, paste and drop all funnel a chosen file through here. An empty
  // or oversized file is refused inline, before any request.
  const acceptFile = useCallback((file: File): void => {
    setAttachmentError(undefined);
    if (file.size === 0) {
      setAttachmentError('That file is empty.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError('That file is larger than 50 MB.');
      return;
    }
    setAttachment({ file, kind: classify(file) });
  }, []);

  const attachmentPreviewUrl = useMemo(
    () =>
      attachment !== undefined && attachment.kind === 'image'
        ? objectUrlFor(attachment.file)
        : undefined,
    [attachment],
  );

  // The preview thumbnail's object URL is revoked when it is replaced or the
  // composer unmounts, so it never leaks.
  useEffect(
    () => () => {
      if (attachmentPreviewUrl !== undefined) {
        URL.revokeObjectURL(attachmentPreviewUrl);
      }
    },
    [attachmentPreviewUrl],
  );

  // A file dropped anywhere on the chat panel (or the page) opens the preview,
  // exactly like the picker.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') === true) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent): void => {
      const file = event.dataTransfer?.files[0];
      if (file === undefined) {
        return;
      }
      event.preventDefault();
      acceptFile(file);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [acceptFile]);

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    const transfer = event.clipboardData;
    if (transfer === undefined) {
      return;
    }
    let file = transfer.files[0];
    if (file === undefined) {
      for (let index = 0; index < transfer.items.length; index += 1) {
        const item = transfer.items[index];
        if (item !== undefined && item.kind === 'file') {
          const fromItem = item.getAsFile();
          if (fromItem !== null) {
            file = fromItem;
            break;
          }
        }
      }
    }
    if (file !== undefined) {
      event.preventDefault();
      acceptFile(file);
    }
  };

  // A pointer-down outside the sticker toggle + panel closes the panel.
  // The toggle button lives inside the wrapper, so clicking it to open
  // never counts as "outside" (it fires before the toggle's click).
  useEffect(() => {
    if (!stickerOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (
        stickerWrapRef.current !== null &&
        event.target instanceof Node &&
        !stickerWrapRef.current.contains(event.target) &&
        document.querySelector('[data-testid="sticker-panel"]')?.contains(event.target) !== true
      ) {
        setStickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [stickerOpen]);
  // Set when a pick or a mention deletion decides where the caret goes; applied
  // after the controlled value has been committed to the textarea.
  const pendingCaretRef = useRef<number | undefined>(undefined);
  // The message being edited, in this chat only.
  const editTarget = store.editTarget;
  const editing =
    editTarget !== undefined && editTarget.chatId === chatId
      ? store.messages(chatId).find((message) => message.id === editTarget.messageId)
      : undefined;
  const editingId = editing?.id;
  const editingText = editing?.text;
  const editingMentions = editing?.mentions;
  const lastEditingIdRef = useRef<string | undefined>(undefined);
  const actionError =
    store.actionError !== undefined && store.actionError.chatId === chatId
      ? store.actionError.message
      : undefined;
  // A mention picked in one chat must never be sent into another: when the chat
  // changes, drop the tracked mentions and any open picker during render. The
  // draft text itself stays, as it did before.
  // A sticker picked in one chat must never be sent into another: like the
  // tracked mentions, the open panel closes on a chat switch.
  if (trackedChatId !== chatId) {
    setTrackedChatId(chatId);
    setMentions([]);
    setPicker(undefined);
    setActiveIndex(0);
    setAttachment(undefined);
    setAttachmentError(undefined);
    setStickerOpen(false);
  }
  const canSend = value.trim().length > 0 || attachment !== undefined;
  const title = store.chats.find((chat) => chat.id === chatId)?.title;
  const placeholder = title === undefined ? 'Message' : `Message ${title}`;
  const isGroup = store.chats.find((chat) => chat.id === chatId)?.kind === 'group';
  const meJid = store.me?.jid ?? undefined;
  const members = isGroup
    ? store.groupMembers(chatId).filter((member) => !isMentionOfMe(member.jid, meJid))
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

  // Entering edit mode prefills the composer with the message's text (caret at
  // the end); leaving it clears the composer again.
  useEffect(() => {
    const previous = lastEditingIdRef.current;
    lastEditingIdRef.current = editingId;
    if (editingId === undefined) {
      if (previous !== undefined) {
        setValue('');
        setMentions([]);
        setPicker(undefined);
      }
      return;
    }
    if (editingId === previous) {
      return;
    }
    const text = editingText ?? '';
    setValue(text);
    setMentions(editingMentions ?? []);
    setPicker(undefined);
    setActiveIndex(0);
    pendingCaretRef.current = text.length;
  }, [editingId, editingText, editingMentions]);

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

  // Cancels any in-flight recording when the composer unmounts.
  useEffect(
    () => () => {
      if (pressRef.current?.holdTimer !== undefined) {
        stopTimer(pressRef.current.holdTimer);
      }
      pressRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recordingRef.current = false;
      recorder?.cancel();
    },
    [],
  );

  // Escape cancels a click-mode recording (before the textarea's own
  // Escape handlers for pickers, attachments, edits and replies).
  const cancelRecording = useCallback((): boolean => {
    if (!recordingRef.current) {
      return false;
    }
    if (pressRef.current?.holdTimer !== undefined) {
      stopTimer(pressRef.current.holdTimer);
    }
    pressRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingRef.current = false;
    recorder?.cancel();
    setRecording(false);
    setLocked(false);
    setCancelArmed(false);
    return true;
  }, []);

  // Switching chats while recording stops the microphone tracks (the
  // browser's recording indicator must go off) and discards the recording.
  // A leftover error belongs to the previous chat, so it is cleared too.
  useEffect(() => {
    if (!recordingRef.current && pressRef.current?.holdTimer === undefined) {
      return;
    }
    if (pressRef.current?.holdTimer !== undefined) {
      stopTimer(pressRef.current.holdTimer);
    }
    pressRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingRef.current = false;
    recorder?.cancel();
    setRecording(false);
    setLocked(false);
    setCancelArmed(false);
    setVoiceError(undefined);
  }, [chatId]);

  useEffect(() => {
    if (!recording) {
      return;
    }
    // The first tick comes after 100 ms, then every 100 ms, as `setInterval` did.
    const tick = Effect.sync(() => {
      const recorder = recorderRef.current;
      if (recorder !== null) {
        setElapsedMs(recorder.durationMs);
      }
    });
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(100)).pipe(Effect.delay(100), Effect.asVoid),
    );
    return () => stopTimer(timer);
  }, [recording]);

  // Escape is a backstop while recording (click mode or a held press):
  // a document listener, since the mic button holds pointer capture and
  // the textarea is hidden while the recording row shows.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRecording();
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [recording, cancelRecording]);

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

  // A sticker sends at once through the store (same path as other payload
  // messages): optimistic bubble, failure shows the usual retry.
  const sendSticker = useCallback(
    (sticker: StickerChoice): void => {
      store.sendSticker(chatId, sticker, replyTo === undefined ? undefined : { replyTo });
      setStickerOpen(false);
      onCancelReply();
    },
    [chatId, onCancelReply, replyTo, store],
  );

  // A GIF pick fetches the media through the proxy, then uploads it with the
  // existing attachment path and sends an attachment message (T-0122): the
  // sent GIF is stored as our attachment and keeps working if the provider
  // disappears. A caption is whatever the composer holds. The mime and the
  // extension come from the proxied blob's real content type (validated
  // against what the proxy serves), never from the search result's kind.
  // Failures show the inline error; the attachment bubble's Retry covers
  // upload failures.
  const sendGif = useCallback(
    (gif: GifChoice): void => {
      const caption = value.trim();
      setStickerOpen(false);
      onCancelReply();
      setAttachmentError(undefined);
      const loadFailed = (): ComposerFailure => new ComposerFailure({ message: GIF_LOAD_FAILED });
      fork(
        Effect.tryPromise({
          try: (signal) => fetch(gif.url, { credentials: 'same-origin', signal }),
          catch: loadFailed,
        }).pipe(
          // The proxy refused the media.
          Effect.filterOrFail((response) => response.ok, loadFailed),
          Effect.flatMap((response) =>
            Effect.tryPromise({ try: () => response.blob(), catch: loadFailed }),
          ),
          Effect.filterOrFail((blob) => blob.size > 0, loadFailed),
          Effect.flatMap((blob) =>
            Effect.sync(() => {
              const { mime, extension } = gifBlobType(blob.type, gif.kind);
              const file = new File([blob], `gif-${gif.id.slice(0, 16)}.${extension}`, {
                type: mime,
              });
              store.sendAttachment(chatId, file, {
                ...(caption.length === 0 ? {} : { caption }),
                ...(replyTo === undefined ? {} : { replyTo }),
              });
            }),
          ),
          Effect.catchTag('ComposerFailure', (failure) =>
            Effect.sync(() => setAttachmentError(failure.message)),
          ),
        ),
      );
    },
    [chatId, onCancelReply, replyTo, store, value],
  );

  const send = (): void => {
    if (attachment !== undefined) {
      store.sendAttachment(chatId, attachment.file, {
        ...(value.trim().length === 0 ? {} : { caption: value.trim() }),
        ...(replyTo === undefined ? {} : { replyTo }),
      });
      setAttachment(undefined);
      setValue('');
      setMentions([]);
      setPicker(undefined);
      onCancelReply();
      return;
    }
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

  // Enter saves the edit; an unchanged text just leaves edit mode, and an empty
  // text never reaches here (the save key is disabled).
  const saveEdit = (): void => {
    if (editing === undefined || value.trim().length === 0) {
      return;
    }
    if (value.trim() === (editing.text ?? '')) {
      store.cancelEdit();
      return;
    }
    store.editMessage(chatId, editing.id, value);
    store.cancelEdit();
  };

  // ↑ in an empty composer edits my last editable message, as in most messengers.
  const editLastMessage = (): void => {
    const last = [...store.messages(chatId)]
      .reverse()
      .find((message) => canEditMessage(message, store.currentUserId, new Date()));
    if (last !== undefined) {
      store.startEdit(chatId, last.id);
    }
  };

  // Escape cancels an active recording first, before the textarea's own
  // handlers for pickers, attachments, edits and replies. Hold-mode presses
  // are bound to the mic button instead and end on release, but Escape is a
  // harmless backstop for them too while the button still has capture.
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && recordingRef.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelRecording();
      return;
    }
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

    // Esc cancels the pending attachment only when it is the last step left
    // (an empty caption); once there is text, Esc belongs to the composer.
    if (event.key === 'Escape' && attachment !== undefined && value.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      setAttachment(undefined);
      return;
    }

    if (event.key === 'ArrowUp' && editing === undefined && replyTo === undefined) {
      if (value.length === 0) {
        event.preventDefault();
        editLastMessage();
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

    if (event.key === 'Escape' && editing !== undefined) {
      event.preventDefault();
      // Keep the key from also closing the chat on a narrow layout.
      event.stopPropagation();
      store.cancelEdit();
      return;
    }
    if (event.key === 'Escape' && replyTo !== undefined) {
      event.preventDefault();
      onCancelReply();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (editing !== undefined) {
        saveEdit();
      } else {
        send();
      }
    }
  };

  // The permission prompt must never cancel the recording: only an
  // explicit release after the recorder has started can finish it. The
  // press is captured in a local so the async `start()` below can tell a
  // stale prompt (chat switched, composer unmounted) from the live one.
  // The reply is read through `replyRef` at send time: it may change while
  // the browser's microphone prompt is showing, and the document pointer
  // listeners below are registered once with a stale closure.
  const beginRecording = (startX: number, clickMode: boolean): void => {
    const press: PressState = {
      startX,
      slidToCancel: false,
      released: false,
      hold: false,
      holdTimer: undefined,
    };
    pressRef.current = press;
    setVoiceError(undefined);
    setElapsedMs(0);
    setLocked(false);
    setCancelArmed(false);
    if (!clickMode) {
      press.holdTimer = Effect.runFork(
        Effect.sleep(HOLD_MS).pipe(
          // A press held this long is a hold-to-send: when the recorder starts
          // it runs in hold mode until release.
          Effect.andThen(
            Effect.sync(() => {
              press.hold = true;
            }),
          ),
        ),
      );
    }
    // `runFork` starts the fiber at once, so `VoiceRecorder.start()` still runs
    // inside the click (the microphone permission needs it); only the wait for
    // the result is an Effect.
    fork(
      Effect.tryPromise({
        try: () => VoiceRecorder.start(),
        catch: (error) =>
          new ComposerFailure({
            message: error instanceof VoiceError ? error.message : 'Microphone unavailable',
          }),
      }).pipe(
        Effect.match({
          onFailure: (failure) => onRecorderFailed(press, failure.message),
          onSuccess: (recorder) => onRecorderStarted(press, recorder, clickMode),
        }),
      ),
    );
  };

  const onRecorderFailed = (press: PressState, message: string): void => {
    if (pressRef.current !== press) {
      return;
    }
    if (press.holdTimer !== undefined) {
      stopTimer(press.holdTimer);
      press.holdTimer = undefined;
    }
    pressRef.current = null;
    setVoiceError(message);
  };

  const onRecorderStarted = (
    press: PressState,
    recorder: VoiceRecorder,
    clickMode: boolean,
  ): void => {
    // The composer unmounted or the chat switched while the prompt was up.
    if (pressRef.current !== press) {
      recorder.cancel();
      return;
    }
    recorderRef.current = recorder;
    recordingRef.current = true;
    setRecording(true);
    setElapsedMs(0);
    if (clickMode) {
      // Keyboard / assistive-technology activation: no release will arrive,
      // so the recording runs in click mode with Send and Cancel to finish.
      pressRef.current = null;
      setLocked(true);
      return;
    }
    if (press.released) {
      if (press.hold) {
        // A long press released during the prompt still sends: it was
        // always a hold gesture, even though the recorder started late.
        if (press.holdTimer !== undefined) {
          stopTimer(press.holdTimer);
          press.holdTimer = undefined;
        }
        finishRecording(false);
      } else {
        // A short press released during the prompt: the user clicked while
        // the browser asked for permission. Keep recording in click mode
        // instead of silently discarding it. The press is over either way,
        // so its hold timer is cleared.
        if (press.holdTimer !== undefined) {
          stopTimer(press.holdTimer);
          press.holdTimer = undefined;
        }
        pressRef.current = null;
        setLocked(true);
      }
    } else if (press.hold) {
      // The hold threshold passed while the prompt was up, with the button
      // still down: this is a hold-to-send, finished by the release.
    } else {
      // The recorder beat the hold timer with the button still down: this
      // may still become a hold or fall back to click mode on release.
    }
  };

  // Stops the recorder and either sends or discards the result. `cancel`
  // discards (trash button, slide-off, Escape); otherwise the recording is
  // validated and sent through the store. The reply is read through
  // `replyRef`, never a closure: the document pointer listeners below are
  // registered once and would otherwise send a stale mount-time reply.
  const finishRecording = (cancel: boolean): void => {
    const press = pressRef.current;
    const recorder = recorderRef.current;
    pressRef.current = null;
    recorderRef.current = null;
    recordingRef.current = false;
    setRecording(false);
    setLocked(false);
    setCancelArmed(false);
    if (recorder === null) {
      return;
    }
    if (cancel || press?.slidToCancel === true) {
      recorder.cancel();
      return;
    }

    const saveFailed = (): ComposerFailure => new ComposerFailure({ message: VOICE_SAVE_FAILED });
    fork(
      Effect.gen(function* () {
        const recorded = yield* Effect.tryPromise({
          try: () => recorder.stop(),
          catch: saveFailed,
        });
        if (recorded.durationMs < VOICE_MIN_MS) {
          return yield* Effect.fail(new ComposerFailure({ message: 'Recording too short' }));
        }
        if (recorded.blob.size > VOICE_MAX_BYTES) {
          return yield* Effect.fail(new ComposerFailure({ message: 'Recording is too long' }));
        }
        const reply = replyRef.current;
        const waveform = yield* Effect.tryPromise({
          try: () => computeWaveform(recorded.blob),
          catch: saveFailed,
        });
        yield* Effect.try({
          try: () =>
            store.sendVoice(
              chatIdRef.current,
              { blob: recorded.blob, durationMs: recorded.durationMs, waveform },
              reply === undefined ? undefined : { replyTo: reply },
            ),
          catch: saveFailed,
        });
        onCancelReply();
      }).pipe(
        Effect.catchTag('ComposerFailure', (failure) =>
          Effect.sync(() => setVoiceError(failure.message)),
        ),
      ),
    );
  };

  // Press-and-hold still works for touch and mouse: a press held past
  // 400 ms sends on release (sliding left cancels instead). A shorter
  // press falls back to click mode and keeps recording until Send. The
  // recording starts on pointer-down and ends on pointer-up; a click
  // without pointer events (keyboard activation) starts a click-mode
  // recording instead, with Send and Cancel and no hold timer.
  const onMicClick = (): void => {
    if (pressRef.current !== null || canSend || recordingRef.current) {
      return;
    }
    beginRecording(0, true);
  };

  const onMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (canSend || recordingRef.current || pressRef.current !== null) {
      return;
    }
    event.preventDefault();
    // jsdom has no pointer capture: guard the call so the recording still
    // starts there (and in any browser where capture throws).
    const target = event.currentTarget as HTMLElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    // Pointer capture is best-effort; the press state still works without it.
    Effect.runSync(
      Effect.ignore(
        Effect.try(() => {
          target.setPointerCapture?.(event.pointerId);
        }),
      ),
    );
    beginRecording(event.clientX, false);
  };

  // The slide-to-cancel gesture while holding: shared with the document
  // pointer-move listener below.
  const onMicPointerMove = (clientX: number): void => {
    const press = pressRef.current;
    if (press === null || recorderRef.current === null) {
      return;
    }
    const cancel = clientX < press.startX - SLIDE_CANCEL_PX;
    press.slidToCancel = cancel;
    setCancelArmed(cancel);
  };

  const onMicPointerUp = (): void => {
    const press = pressRef.current;
    if (press === null) {
      // Click mode: the mic button is hidden while recording, so a press
      // here means the recorder never started; nothing to finish.
      if (recorderRef.current !== null) {
        finishRecording(false);
      }
      return;
    }
    if (press.holdTimer !== undefined) {
      stopTimer(press.holdTimer);
      press.holdTimer = undefined;
    }
    press.released = true;
    if (recorderRef.current === null) {
      // The permission prompt is still up: `beginRecording` decides on
      // hold vs. click mode once `VoiceRecorder.start()` resolves.
      return;
    }
    if (press.hold && !press.slidToCancel) {
      // A long press: releasing sends, as before.
      finishRecording(false);
      return;
    }
    if (press.slidToCancel) {
      finishRecording(true);
      return;
    }
    // A hold released before the recorder started but after the prompt
    // resolved is handled by `beginRecording` (late-grant path above). A
    // pointer-up that arrives here with a live recorder and a short press
    // keeps recording in click mode until Send or Cancel.
    pressRef.current = null;
    setLocked(true);
  };

  // The pointer-up may land anywhere: with pointer capture the browser
  // retargets it to the mic button (since replaced by the recording row),
  // without capture it lands on the element under the pointer. A document
  // listener finishes the press no matter where it lands; same for the
  // slide-to-cancel move.
  useEffect(() => {
    const onDocumentPointerUp = (): void => {
      if (pressRef.current !== null) {
        onMicPointerUp();
      }
    };
    const onDocumentPointerMove = (event: globalThis.PointerEvent): void => {
      onMicPointerMove(event.clientX);
    };
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointermove', onDocumentPointerMove);
    return () => {
      document.removeEventListener('pointerup', onDocumentPointerUp);
      document.removeEventListener('pointermove', onDocumentPointerMove);
    };
    // `onMicPointerUp` reads live refs, so the listener is stable across
    // renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMicPointerCancel = (): void => {
    // The system took over the gesture (an alert, a call): keep a started
    // recording in click mode rather than silently dropping it, but do not
    // resurrect a prompt that failed before starting.
    const press = pressRef.current;
    if (press?.holdTimer !== undefined) {
      stopTimer(press.holdTimer);
      press.holdTimer = undefined;
    }
    pressRef.current = null;
    if (recorderRef.current !== null) {
      setLocked(true);
    }
  };

  return (
    <div
      onPaste={onPaste}
      className="chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5"
    >
      {pickerOpen && (
        <MentionPicker
          id={MENTION_PICKER_ID}
          members={candidates}
          activeIndex={activeRow}
          onSelect={pickMention}
          onHover={setActiveIndex}
        />
      )}
      {editing !== undefined ? (
        <EditBar text={editing.text ?? ''} onCancel={() => store.cancelEdit()} />
      ) : (
        replyTo !== undefined && (
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
        )
      )}
      {attachment !== undefined && (
        <AttachmentPreview
          attachment={attachment}
          previewUrl={attachmentPreviewUrl}
          onCancel={() => setAttachment(undefined)}
        />
      )}
      {(voiceError !== undefined || attachmentError !== undefined) && (
        <div className="mb-1 px-1 text-[12px] text-danger" role="alert">
          {voiceError ?? attachmentError}
        </div>
      )}
      {voiceError === undefined && attachmentError === undefined && actionError !== undefined && (
        <div className="mb-1 px-1 text-[12px] text-danger" role="alert">
          {actionError}
        </div>
      )}
      <Well className="flex items-end gap-2 rounded-[14px] p-2">
        {recording ? (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-3 px-1">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
            <span className="shrink-0 text-[15px] tabular-nums" aria-live="off">
              {formatDuration(elapsedMs)}
            </span>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-muted-foreground">
              {cancelArmed ? 'Release to cancel' : locked ? 'Tap Send to send' : 'Slide to cancel'}
            </span>
            {locked && (
              <IconButton aria-label="Cancel voice message" onClick={cancelRecording} size={36}>
                <Trash2 className="size-5" aria-hidden="true" />
              </IconButton>
            )}
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple={false}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen !== undefined) {
                  acceptFile(chosen);
                }
                event.target.value = '';
              }}
            />
            <IconButton aria-label="Attach a file" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="size-5" aria-hidden="true" />
            </IconButton>
            <textarea
              ref={textareaRef}
              id="message-composer"
              name="message"
              rows={1}
              value={value}
              onChange={(event) => onChange(event.target.value, event.target.selectionStart ?? 0)}
              onKeyDown={onComposerKeyDown}
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
            <span ref={stickerWrapRef} className="inline-flex shrink-0">
              <IconButton
                aria-label="Open sticker panel"
                aria-expanded={stickerOpen}
                onClick={() => setStickerOpen((open) => !open)}
              >
                <Smile className="size-5" aria-hidden="true" />
              </IconButton>
            </span>
            {stickerOpen && (
              <StickerPanel
                onPick={sendSticker}
                onClose={() => setStickerOpen(false)}
                onGifPick={sendGif}
                onManage={() => {
                  setStickerOpen(false);
                  onOpenStickersSettings?.();
                }}
                onCreate={() => {
                  setStickerOpen(false);
                  onOpenStickersSettings?.();
                }}
                onEmoji={(emoji) => {
                  const caret = textareaRef.current?.selectionStart ?? value.length;
                  const next = `${value.slice(0, caret)}${emoji}${value.slice(caret)}`;
                  onChange(next, caret + emoji.length);
                  pendingCaretRef.current = caret + emoji.length;
                  textareaRef.current?.focus();
                }}
              />
            )}
          </>
        )}
        {recording && locked ? (
          <Button
            type="button"
            aria-label="Send voice message"
            onClick={() => finishRecording(false)}
            className="size-9 rounded-[10px] p-0"
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        ) : canSend ? (
          <Button
            type="button"
            aria-label={editing !== undefined ? 'Save edit' : 'Send message'}
            onClick={editing !== undefined ? saveEdit : send}
            className="size-9 rounded-[10px] p-0"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        ) : editing !== undefined ? (
          <Button
            type="button"
            aria-label="Save edit"
            disabled
            className="size-9 rounded-[10px] p-0"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <IconButton
            aria-label="Record voice message"
            onClick={onMicClick}
            onPointerDown={onMicPointerDown}
            onPointerCancel={onMicPointerCancel}
          >
            <Mic className="size-5" aria-hidden="true" />
          </IconButton>
        )}
      </Well>
    </div>
  );
}
