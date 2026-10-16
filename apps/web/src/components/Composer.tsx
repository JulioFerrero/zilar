import { canEditMessage, composerPlaceholder, type ReplyRef } from '@zilar/chat-core';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ComposerControls } from './composer/ComposerControls';
import { useFormatShortcut } from './composer/formatShortcut';
import { useComposerAttachments, type SendPendingOptions } from './composer/useComposerAttachments';
import { useComposerFocus } from './composer/useComposerFocus';
import { beginEdit, endEdit, useDraftValue } from './composer/useDraftValue';
import { useMentions } from './composer/useMentions';
import { useRecordingLifecycle } from './composer/useRecordingLifecycle';
import { useVoiceRecorder } from './composer/useVoiceRecorder';
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
  const [value, setValue] = useDraftValue(chatId);
  // The chat the tracked mentions belong to, so a chat switch resets them below.
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
  // Reply and Edit focus the composer (T-1482).
  useComposerFocus(chatId, textareaRef, replyTo?.id ?? editingId);
  const lastEditingIdRef = useRef<string | undefined>(undefined);
  const actionError =
    storedActionError !== undefined && storedActionError.chatId === chatId
      ? storedActionError.message
      : undefined;
  const isGroup = chat?.kind === 'group';

  const mentions = useMentions({ chatId, meJid, isGroup, value, setValue, storeApi, textareaRef });
  // Ctrl/Cmd+B/+I/+E on the selection; goes through `onChange` so mentions rebase.
  const onFormatKeyDown = useFormatShortcut(value, textareaRef, mentions.onChange);
  const attachments = useComposerAttachments({ chatId, value, replyTo, onCancelReply, storeApi });
  const canSend = value.trim().length > 0 || attachments.attachment !== undefined;
  const voice = useVoiceRecorder({ chatId, replyTo, onCancelReply, storeApi, canSend });

  const { setMentions, setPicker, setActiveIndex, pendingCaretRef } = mentions;
  const { attachment, setAttachment } = attachments;
  const { recordingRef, cancelRecording } = voice;

  // A mention or sticker picked in one chat must never be sent into another: drop
  // them and any open panel on a chat switch. The text stays per chat (useDraftValue).
  if (trackedChatId !== chatId) {
    setTrackedChatId(chatId);
    mentions.reset();
    attachments.reset();
  }

  const placeholder = composerPlaceholder(chat?.title);

  // Entering edit mode prefills the composer with the message's text (caret at
  // the end); leaving it restores the draft kept aside (WUX-3).
  useEffect(() => {
    const previous = lastEditingIdRef.current;
    lastEditingIdRef.current = editingId;
    if (editingId === undefined) {
      if (previous !== undefined) {
        endEdit(chatId);
        setMentions([]);
        setPicker(undefined);
      }
      return;
    }
    if (editingId === previous) {
      return;
    }
    const text = editingText ?? '';
    beginEdit(chatId, text);
    setMentions(editingMentions ?? []);
    setPicker(undefined);
    setActiveIndex(0);
    pendingCaretRef.current = text.length;
  }, [
    chatId,
    editingId,
    editingText,
    editingMentions,
    setMentions,
    setPicker,
    setActiveIndex,
    pendingCaretRef,
  ]);

  useRecordingLifecycle({ chatId, voice });

  const send = (options?: SendPendingOptions): void => {
    if (attachment !== undefined) {
      attachments.sendPending(options);
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
    if (mentions.onMentionKeyDown(event) || onFormatKeyDown(event)) {
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
      event.stopPropagation();
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
