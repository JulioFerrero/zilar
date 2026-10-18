import {
  canEditMessage,
  composerPlaceholder,
  mentionInTopic,
  type ReplyRef,
  type UiMention,
} from '@zilar/chat-core';
import { useEffect, useRef, useState, type KeyboardEvent, useCallback } from 'react';
import { ComposerControls } from './composer/ComposerControls';
import { useFormatShortcut } from './composer/formatShortcut';
import { useComposerAttachments, type SendPendingOptions } from './composer/useComposerAttachments';
import { useComposerFocus } from './composer/useComposerFocus';
import { useMentions } from './composer/useMentions';
import { useRecordingLifecycle } from './composer/useRecordingLifecycle';
import { useVoiceRecorder } from './composer/useVoiceRecorder';
import { AddToTopicRow } from './topic/TopicNotInRow';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { getDraft, setDraft, useComposerDraft } from '@/lib/composer-drafts';

// The draft set aside while a chat's message is edited (WUX-3): edit mode
// pre-fills the composer, and leaving it restores this draft, so editing never
// consumes the in-progress draft. Entries are keyed by user and chat, so one
// account's stashed text can never reach another account's composer.
const draftsSetAside = new Map<string, string>();
let setAsideUserId = '';

// A different signed-in user starts from an empty stash: the old account's
// entries are dropped so they can never collide with the new account's keys.
function scopeSetAside(userId: string): void {
  if (userId !== setAsideUserId) {
    setAsideUserId = userId;
    draftsSetAside.clear();
  }
}

function stashKey(chatId: string): string {
  return `${setAsideUserId}:${chatId}`;
}

function beginEdit(chatId: string, text: string): void {
  const key = stashKey(chatId);
  if (!draftsSetAside.has(key)) {
    draftsSetAside.set(key, getDraft(chatId));
  }
  setDraft(chatId, text);
}

/**
 * Nothing set aside (a switch dropped the stash) restores nothing, so it never
 * writes the previous account's text — or an empty one — into the composer.
 */
function endEdit(chatId: string): void {
  const key = stashKey(chatId);
  if (!draftsSetAside.has(key)) {
    return;
  }
  const kept = draftsSetAside.get(key) ?? '';
  draftsSetAside.delete(key);
  setDraft(chatId, kept);
}

function useDraftValue(chatId: string): [string, (next: string) => void] {
  // Scope the edit stash to the signed-in user (the same id `composer-drafts`
  // uses) before the composer can read it.
  const currentUserId = useChatSelector((s) => s.currentUserId);
  scopeSetAside(currentUserId);
  const value = useComposerDraft(chatId);
  const setValue = useCallback(
    (next: string): void => {
      setDraft(chatId, next);
    },
    [chatId],
  );
  return [value, setValue];
}

interface TopicNotIn {
  jid: string;
  name: string;
  kind: 'person' | 'ai';
  id: string;
  avatarUrl?: string;
}

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
  onOpenStickersSettings?: (() => void) | undefined;
}) {
  const storeApi = useChatStoreApi();
  const chat = useChatSelector((s) => s.chats.find((entry) => entry.id === chatId));
  const meJid = useChatSelector((s) => s.me?.jid ?? undefined);
  const storedActionError = useChatSelector((s) => s.actionError);
  const [value, setValue] = useDraftValue(chatId);
  const [trackedChatId, setTrackedChatId] = useState(chatId);
  const [notInTopic, setNotInTopic] = useState<TopicNotIn[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editing = useChatSelector((s) => {
    const target = s.editTarget;
    return target !== undefined && target.chatId === chatId
      ? s.messagesByChat[chatId]?.find((message) => message.id === target.messageId)
      : undefined;
  });
  const editingId = editing?.id;
  const editingText = editing?.text;
  const editingMentions = editing?.mentions;
  useComposerFocus(chatId, textareaRef, replyTo?.id ?? editingId);
  const lastEditingIdRef = useRef<string | undefined>(undefined);
  const actionError =
    storedActionError !== undefined && storedActionError.chatId === chatId
      ? storedActionError.message
      : undefined;
  const isGroup = chat?.kind === 'group';

  const mentions = useMentions({ chatId, meJid, isGroup, value, setValue, storeApi, textareaRef });
  const onFormatKeyDown = useFormatShortcut(value, textareaRef, mentions.onChange);
  const attachments = useComposerAttachments({ chatId, value, replyTo, onCancelReply, storeApi });
  const canSend = value.trim().length > 0 || attachments.attachment !== undefined;
  const voice = useVoiceRecorder({ chatId, replyTo, onCancelReply, storeApi, canSend });

  const { setMentions, setPicker, setActiveIndex, pendingCaretRef } = mentions;
  const { attachment, setAttachment } = attachments;
  const { recordingRef, cancelRecording } = voice;

  // A mention or sticker picked in one chat must never be sent into another.
  if (trackedChatId !== chatId) {
    setTrackedChatId(chatId);
    mentions.reset();
    attachments.reset();
    setNotInTopic([]);
  }

  const placeholder = composerPlaceholder(chat?.title);

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

  const editLastMessage = (): void => {
    const state = storeApi.getState();
    const last = [...state.messages(chatId)]
      .reverse()
      .find((message) => canEditMessage(message, state.currentUserId, new Date()));
    if (last !== undefined) {
      state.startEdit(chatId, last.id);
    }
  };

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
      className="pointer-events-none relative px-3 pt-2 pb-3 *:pointer-events-auto wide:px-8 wide:pt-3 wide:pb-5"
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
