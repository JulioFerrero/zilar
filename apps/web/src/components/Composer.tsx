import { Avatar } from './Avatar';
import { Button } from './ui/button';
import { ComposerControls } from './composer/ComposerControls';
import { useComposerAttachments, type SendPendingOptions } from './composer/useComposerAttachments';
import { useComposerFocus } from './composer/useComposerFocus';
import { useMentions } from './composer/useMentions';
import { useRecordingLifecycle } from './composer/useRecordingLifecycle';
import { useVoiceRecorder } from './composer/useVoiceRecorder';
import { getDraft, setDraft, useComposerDraft } from '@/lib/composer-drafts';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  canEditMessage,
  composerPlaceholder,
  mentionInTopic,
  type ReplyRef,
  type UiMention,
} from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  type RefObject,
} from 'react';
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

type TopicNotInState = 'idle' | 'busy' | 'failed';

export function TopicNotInRow({
  name,
  avatarUrl,
  topicTitle,
  state,
  onAdd,
}: {
  name: string;
  avatarUrl?: string | undefined;
  topicTitle: string;
  state: TopicNotInState;
  onAdd: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-[14px] border border-[#232323] bg-[#141414] py-1.5 pr-1.5 pl-3"
    >
      <Avatar seed={name} name={name} size={22} avatarUrl={avatarUrl} />
      <span className="text-[14px] text-[#a1a1a1]">
        {name} isn&apos;t in {topicTitle}
      </span>
      {state === 'failed' ? (
        <span className="pr-1.5 text-[13px] text-muted-foreground">Couldn&apos;t add</span>
      ) : (
        <Button size="sm" disabled={state === 'busy'} onClick={onAdd}>
          {state === 'busy' ? 'Adding…' : 'Add'}
        </Button>
      )}
    </div>
  );
}

class AddToTopicFailed extends Data.TaggedError('AddToTopicFailed') {}

function AddToTopicRow({
  name,
  avatarUrl,
  topicTitle,
  add,
  onAdded,
}: {
  name: string;
  avatarUrl?: string | undefined;
  topicTitle: string;
  add: () => Promise<void>;
  onAdded: () => void;
}) {
  const [state, run] = useAction<void, void, AddToTopicFailed>(() =>
    Effect.tryPromise({ try: add, catch: () => new AddToTopicFailed() }),
  );
  const done = AsyncResult.isSuccess(state);
  useEffect(() => {
    if (done) {
      onAdded();
    }
  }, [done, onAdded]);
  return (
    <TopicNotInRow
      name={name}
      avatarUrl={avatarUrl}
      topicTitle={topicTitle}
      state={isWaiting(state) ? 'busy' : failureOf(state) === undefined ? 'idle' : 'failed'}
      onAdd={() => run()}
    />
  );
}

const BOLD = '**';
/** The italic marker light markdown accepts at word edges (`_…_`, not `*…*`). */
const ITALIC = '_';
const CODE = '`';

interface FormattedText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function markerFor(event: KeyboardEvent<HTMLTextAreaElement>): string | undefined {
  if (event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  if (key === 'b') {
    return BOLD;
  }
  if (key === 'i') {
    return ITALIC;
  }
  if (key === 'e') {
    return CODE;
  }
  return undefined;
}

function applyFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): FormattedText {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const selected = value.slice(start, end);

  if (
    start >= marker.length &&
    value.slice(start - marker.length, start) === marker &&
    value.slice(end, end + marker.length) === marker
  ) {
    return {
      value: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length),
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    };
  }

  if (start === end) {
    return {
      value: `${value.slice(0, start)}${marker}${marker}${value.slice(start)}`,
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length,
    };
  }

  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    return {
      value:
        value.slice(0, start) + selected.slice(marker.length, -marker.length) + value.slice(end),
      selectionStart: start,
      selectionEnd: end - marker.length * 2,
    };
  }

  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  };
}

/**
 * The hook restores the selection on the textarea in a layout effect, after
 * React renders the new value but before the browser paints, so the range
 * lines up with the new text instead of the default end caret.
 */
function useFormatShortcut(
  value: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  onChange: (next: string, caret: number) => void,
): (event: KeyboardEvent<HTMLTextAreaElement>) => boolean {
  const pendingRef = useRef<{ start: number; end: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (pending === undefined) {
      return;
    }
    pendingRef.current = undefined;
    textareaRef.current?.setSelectionRange(pending.start, pending.end);
  }, [value, textareaRef]);

  return (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const marker = markerFor(event);
    if (marker === undefined) {
      return false;
    }
    const target = event.currentTarget;
    const next = applyFormat(value, target.selectionStart, target.selectionEnd, marker);
    event.preventDefault();
    pendingRef.current = { start: next.selectionStart, end: next.selectionEnd };
    onChange(next.value, next.selectionEnd);
    return true;
  };
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
