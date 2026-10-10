import { canEditMessage, type ReplyRef } from '@zilar/chat-core';
import { Effect, Schedule } from 'effect';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ComposerControls } from './composer/ComposerControls';
import { useComposerAttachments } from './composer/useComposerAttachments';
import { useMentions } from './composer/useMentions';
import { stopTimer, useVoiceRecorder } from './composer/useVoiceRecorder';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

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
  const storeApi = useChatStoreApi();
  const chat = useChatSelector((s) => s.chats.find((entry) => entry.id === chatId));
  const meJid = useChatSelector((s) => s.me?.jid ?? undefined);
  const storedActionError = useChatSelector((s) => s.actionError);
  const [value, setValue] = useState('');
  // The chat the tracked mentions belong to. Kept in state so a chat switch can
  // reset them during render (React's "adjust state when a prop changes").
  const [trackedChatId, setTrackedChatId] = useState(chatId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The message being edited, in this chat only.
  const editing = useChatSelector((s) => {
    const target = s.editTarget;
    return target !== undefined && target.chatId === chatId
      ? s.messagesByChat[chatId]?.find((message) => message.id === target.messageId)
      : undefined;
  });
  const editingId = editing?.id;
  const editingText = editing?.text;
  const editingMentions = editing?.mentions;
  const lastEditingIdRef = useRef<string | undefined>(undefined);
  const actionError =
    storedActionError !== undefined && storedActionError.chatId === chatId
      ? storedActionError.message
      : undefined;
  const isGroup = chat?.kind === 'group';

  const mentions = useMentions({ chatId, meJid, isGroup, value, setValue, storeApi, textareaRef });
  const attachments = useComposerAttachments({ chatId, value, replyTo, onCancelReply, storeApi });
  const canSend = value.trim().length > 0 || attachments.attachment !== undefined;
  const voice = useVoiceRecorder({ chatId, replyTo, onCancelReply, storeApi, canSend });

  const { setMentions, setPicker, setActiveIndex, pendingCaretRef } = mentions;
  const { attachment, setAttachment } = attachments;
  const {
    pressRef,
    recorderRef,
    recordingRef,
    setRecording,
    setLocked,
    setCancelArmed,
    setElapsedMs,
    setVoiceError,
    recording,
    cancelRecording,
    finishRecording,
    onMicPointerMove,
  } = voice;

  // A mention picked in one chat must never be sent into another: when the chat
  // changes, drop the tracked mentions and any open picker during render. The
  // draft text itself stays, as it did before.
  // A sticker picked in one chat must never be sent into another: like the
  // tracked mentions, the open panel closes on a chat switch.
  if (trackedChatId !== chatId) {
    setTrackedChatId(chatId);
    mentions.reset();
    attachments.reset();
  }

  const title = chat?.title;
  const placeholder = title === undefined ? 'Message' : `Message ${title}`;

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
  }, [
    editingId,
    editingText,
    editingMentions,
    setMentions,
    setPicker,
    setActiveIndex,
    pendingCaretRef,
  ]);

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
    [pressRef, recorderRef, recordingRef],
  );

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
  }, [
    chatId,
    pressRef,
    recorderRef,
    recordingRef,
    setRecording,
    setLocked,
    setCancelArmed,
    setVoiceError,
  ]);

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
  }, [recording, recorderRef, setElapsedMs]);

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

  // Finishes a press wherever the pointer-up lands. Read through live refs so
  // the document listener below stays stable across renders.
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

  const send = (): void => {
    if (attachment !== undefined) {
      storeApi.getState().sendAttachment(chatId, attachment.file, {
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
    storeApi.getState().sendText(chatId, value, {
      ...(replyTo === undefined ? {} : { replyTo }),
      ...(mentions.mentions.length === 0 ? {} : { mentions: mentions.mentions }),
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
      storeApi.getState().cancelEdit();
      return;
    }
    storeApi.getState().editMessage(chatId, editing.id, value);
    storeApi.getState().cancelEdit();
  };

  // ↑ in an empty composer edits my last editable message, as in most messengers.
  const editLastMessage = (): void => {
    const state = storeApi.getState();
    const last = [...state.messages(chatId)]
      .reverse()
      .find((message) => canEditMessage(message, state.currentUserId, new Date()));
    if (last !== undefined) {
      state.startEdit(chatId, last.id);
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
    if (mentions.onMentionKeyDown(event)) {
      return;
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

    if (event.key === 'Escape' && editing !== undefined) {
      event.preventDefault();
      // Keep the key from also closing the chat on a narrow layout.
      event.stopPropagation();
      storeApi.getState().cancelEdit();
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

  return (
    <div
      onPaste={attachments.onPaste}
      className="chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5"
    >
      <ComposerControls
        mentions={mentions}
        attachments={attachments}
        voice={voice}
        editor={{
          value,
          onChange: mentions.onChange,
          onKeyDown: onComposerKeyDown,
          textareaRef,
          placeholder,
          canSend,
          isEditing: editing !== undefined,
          editingText: editingText ?? '',
          onCancelEdit: () => storeApi.getState().cancelEdit(),
          saveEdit,
          send,
        }}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        onOpenStickersSettings={onOpenStickersSettings}
        actionError={actionError}
      />
    </div>
  );
}
