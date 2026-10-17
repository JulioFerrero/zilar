import {
  canEditMessage,
  composerPlaceholder,
  mentionInTopic,
  type ReplyRef,
  type UiMention,
} from '@zilar/chat-core';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ComposerControls } from './composer/ComposerControls';
import { useFormatShortcut } from './composer/formatShortcut';
import { useComposerAttachments, type SendPendingOptions } from './composer/useComposerAttachments';
import { useComposerFocus } from './composer/useComposerFocus';
import { beginEdit, endEdit, useDraftValue } from './composer/useDraftValue';
import { useMentions } from './composer/useMentions';
import { useRecordingLifecycle } from './composer/useRecordingLifecycle';
import { useVoiceRecorder } from './composer/useVoiceRecorder';
import { AddToTopicRow } from './topic/TopicNotInRow';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

/** T-1783: a sent mention of someone who is not in the open topic. */
interface TopicNotIn {
  jid: string;
  name: string;
  kind: 'person' | 'ai';
  /** The AI's `aiId` or the person's `userId`, for the Add call. */
  id: string;
  avatarUrl?: string;
}

/** The localpart of a jid, lowercased (`Ana@x` → `ana`). */
function jidLocalpart(jid: string): string {
  const at = jid.indexOf('@');
  return (at === -1 ? jid : jid.slice(0, at)).toLowerCase();
}

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
  // T-1783: the mentions of people outside the open topic that the last send
  // put on screen. Each row owns its Add call (AddToTopicRow).
  const [notInTopic, setNotInTopic] = useState<TopicNotIn[]>([]);
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
    setNotInTopic([]);
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

  // T-1783: after a send in a topic, show the sender the mentions of people
  // who are not in it. A General topic, a non-topic chat and an older server
  // whose `memberIds` is missing produce no rows.
  const surfaceNotInTopic = (sent: readonly UiMention[]): void => {
    const topic = chat?.topic;
    if (topic === undefined || sent.length === 0) {
      setNotInTopic([]);
      return;
    }
    const state = storeApi.getState();
    const detail = state.groupInfo(chatId);
    const aiIdByJid = new Map<string, string>();
    for (const ai of detail?.ais ?? []) {
      aiIdByJid.set(ai.jid, ai.aiId);
    }
    const missing: TopicNotIn[] = [];
    const seen = new Set<string>();
    for (const mention of sent) {
      if (seen.has(mention.jid) || mentionInTopic(topic, mention.jid, aiIdByJid)) {
        continue;
      }
      seen.add(mention.jid);
      const aiId = aiIdByJid.get(mention.jid);
      if (aiId !== undefined) {
        const ai = detail?.ais.find((entry) => entry.aiId === aiId);
        missing.push({
          jid: mention.jid,
          name: mention.name,
          kind: 'ai',
          id: aiId,
          ...(ai?.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
        });
        continue;
      }
      const member = detail?.members.find(
        (entry) => entry.userId.toLowerCase() === jidLocalpart(mention.jid),
      );
      missing.push({
        jid: mention.jid,
        name: mention.name,
        kind: 'person',
        id: member?.userId ?? jidLocalpart(mention.jid),
        ...(member?.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
      });
    }
    setNotInTopic(missing);
  };

  // T-1783: the Add key's call for one entry; its group half is added first on
  // the server (T-1769). The row drops itself through `onAdded` on success.
  const addToTopic = (entry: TopicNotIn): Promise<void> =>
    entry.kind === 'ai'
      ? storeApi.getState().addTopicAi(chatId, entry.id)
      : storeApi.getState().addTopicMember(chatId, entry.id);

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
    surfaceNotInTopic(mentions.mentions);
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

    if (
      event.key === 'ArrowUp' &&
      !event.altKey &&
      editing === undefined &&
      replyTo === undefined
    ) {
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
      {notInTopic.length > 0 && (
        <div className="mb-2 flex flex-col items-center gap-1.5">
          {notInTopic.map((entry) => (
            <AddToTopicRow
              key={entry.jid}
              name={entry.name}
              avatarUrl={entry.avatarUrl}
              topicTitle={chat?.title ?? ''}
              add={() => addToTopic(entry)}
              onAdded={() =>
                setNotInTopic((previous) => previous.filter((item) => item.jid !== entry.jid))
              }
            />
          ))}
        </div>
      )}
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
