import {
  aiSuggestions,
  groupMessages,
  providerLabel,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { fromApi } from '@zilar/client-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { ArrowDown } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiBadge } from './AiBadge';
import { EntityAvatar } from './EntityAvatar';
import { MessageListRow, messageRowKey } from './MessageListRow';
import { MessageListSkeleton } from './Skeleton';
import { useMessageWindow } from './useMessageWindow';
import { useMessageListScroll } from './useMessageListScroll';
import { IconButton } from './ui/icon-button';
import { Badge } from './ui/badge';
import { StateMessage } from './ui/state-message';
import { listAis, listConnections, type AiTemplate } from '@/lib/api';
import { isBlockedSender, useBlockedJids } from '@/lib/blockedJids';
import { chatBackgroundStyle, effectiveBackground } from '@/lib/chatBackground';
import { dmContactFor } from '@/lib/contacts';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

/**
 * Announces only a new incoming message appended to the open chat: history
 * prepends, own sends and the first load are skipped.
 */
function MessageAnnouncer({ messages, meId }: { messages: readonly UiMessage[]; meId: string }) {
  const [announcement, setAnnouncement] = useState('');
  const previousLast = useRef<UiMessage | undefined>(undefined);
  useEffect(() => {
    const previous = previousLast.current;
    const last = messages.at(-1);
    previousLast.current = last;
    if (
      previous !== undefined &&
      last !== undefined &&
      last.id !== previous.id &&
      last.senderId !== meId &&
      messages.includes(previous)
    ) {
      setAnnouncement(`New message from ${last.senderName}`);
    }
  }, [messages, meId]);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
}

const EMPTY_MESSAGES: UiMessage[] = [];

/** A callback whose identity never changes but always calls the latest `fn`. */
function useLatestCallback<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined,
): (...args: A) => void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current?.(...args), []);
}

interface AiEmptyInfo {
  template: AiTemplate;
  model: string;
}

export function EmptyChat({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const contacts = useChatSelector((s) => s.contacts);

  const [aiResult] = useQuery(
    () =>
      chat.isAI
        ? fromApi(() => listAis()).pipe(
            Effect.flatMap((ais) => {
              const found = ais.find((item) => item.jid === chat.id);
              if (found === undefined) {
                return Effect.succeed<AiEmptyInfo | null>(null);
              }
              const fallback: AiEmptyInfo = { template: found.template, model: found.model };
              return fromApi(() => listConnections()).pipe(
                Effect.map((connections): AiEmptyInfo => {
                  const connection = connections.find(
                    (entry) => entry.id === found.providerConnectionId,
                  );
                  return connection === undefined
                    ? fallback
                    : {
                        template: found.template,
                        model: `${found.model} · ${providerLabel(connection.provider)}`,
                      };
                }),
                Effect.orElseSucceed((): AiEmptyInfo => fallback),
              );
            }),
          )
        : Effect.succeed<AiEmptyInfo | null>(null),
    [chat.id, chat.isAI],
  );
  const ai = AsyncResult.isSuccess(aiResult) ? aiResult.value : null;

  if (chat.isAI) {
    const suggestions = aiSuggestions(ai === null ? '' : ai.template);
    return (
      <div className="flex flex-col items-center gap-4">
        <EntityAvatar chat={chat} size={72} ai />
        <div className="flex flex-col items-center gap-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[18px] font-semibold">{chat.title}</span>
            <AiBadge />
          </span>
          {ai !== null && (
            <span className="font-mono text-[12px] text-muted-foreground">{ai.model}</span>
          )}
        </div>
        <div className="mt-2 flex max-w-[520px] flex-wrap justify-center gap-2">
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => storeApi.getState().sendText(chat.id, text, {})}
              className="key-icon flex h-9 items-center rounded-full px-3.5 text-[14px] font-medium"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (chat.kind === 'dm') {
    const known = dmContactFor(chat, contacts)?.handle;
    const handle = known === undefined || known === null || known === '' ? undefined : known;
    return (
      <div className="flex flex-col items-center gap-4">
        <EntityAvatar chat={chat} size={72} />
        <div className="flex flex-col items-center gap-1">
          <span className="text-[18px] font-semibold">{chat.title}</span>
          {handle !== undefined && (
            <span className="font-mono text-[12px] text-muted-foreground">@{handle}</span>
          )}
        </div>
      </div>
    );
  }

  return <StateMessage kind="empty" title="No messages yet" />;
}

export const MessageList = memo(function MessageList({
  chat,
  onReply,
  onForward,
  selection,
  selecting = false,
}: {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
  onForward?: (message: UiMessage) => void;
  selection?: {
    ids: ReadonlySet<string>;
    onToggle: (message: UiMessage) => void;
    onStart: (message: UiMessage) => void;
  };
  selecting?: boolean;
}) {
  const storeApi = useChatStoreApi();
  const chatId = chat.id;
  const chatTitle = chat.title;
  const chatPref = useChatSelector((s) => s.chatPrefs[chatId.toLowerCase()]);
  const defaultBackground = useChatSelector((s) => s.defaultBackground);
  const storedMessages = useChatSelector((s) => s.messagesByChat[chatId]);
  const messages = storedMessages ?? EMPTY_MESSAGES;
  // Unknown means never requested: first paint must never flash the empty state.
  const history = useChatSelector((s) => s.historyStateFor(chatId));
  const pins = useChatSelector((s) => s.pinsByChat[chatId]);
  const pinIdByMessage = useMemo(() => {
    const map = new Map<string, string>();
    for (const pin of pins ?? []) {
      map.set(pin.messageId, pin.id);
    }
    return map;
  }, [pins]);
  const draft = useChatSelector((s) => s.drafts[chatId]);
  const finishedDraftMessages = useChatSelector((s) => s.finishedDraftMessages);
  const meId = useChatSelector((s) => s.currentUserId);
  const meJid = useChatSelector((s) => s.me?.jid ?? undefined);
  // Chat background, else the group's shared one, else the caller's default, else slate.
  const backgroundStyle = chatBackgroundStyle(
    effectiveBackground(chatPref, defaultBackground, chat.groupBackground),
  );
  const draftText = draft?.text.trim() ?? '';
  const draftTurnId = draft?.turnId;
  const blockedJids = useBlockedJids();
  const hideBlocked = chat.kind === 'group' && chat.isAI !== true && blockedJids.size > 0;
  const visibleMessages = useMemo(
    () =>
      hideBlocked
        ? messages.filter(
            (message) =>
              message.senderId === meId || !isBlockedSender(message.senderId, blockedJids),
          )
        : messages,
    [hideBlocked, messages, meId, blockedJids],
  );
  const draftMessage = useMemo<UiMessage | undefined>(
    () =>
      draftTurnId !== undefined && draftText.length > 0
        ? {
            id: `draft-${draftTurnId}`,
            chatId,
            senderId: chatId,
            senderName: chatTitle,
            text: draftText,
            createdAt: new Date(
              Math.max(new Date().getTime(), (messages.at(-1)?.createdAt.getTime() ?? 0) + 1),
            ),
            status: 'read',
          }
        : undefined,
    [draftTurnId, draftText, chatId, chatTitle, messages],
  );
  const items = useMemo(
    () =>
      groupMessages(
        draftMessage === undefined ? visibleMessages : [...visibleMessages, draftMessage],
      ),
    [visibleMessages, draftMessage],
  );
  // Bubbles are memoised, so pass wrappers with a never-changing identity.
  const handleReply = useLatestCallback(onReply);
  const handleForward = useLatestCallback(onForward);
  const handleToggleSelect = useLatestCallback(selection?.onToggle);
  const handleStartSelect = useLatestCallback(selection?.onStart);
  const selectedIds = selection?.ids;
  const [initialUnread] = useState(() => chat.unread);
  const dividerIndex = unreadDividerIndex(items, initialUnread, meId);
  // Draw only the newest window; the unread divider is always drawn.
  const { windowItems, start, hasHidden, reveals, grow } = useMessageWindow(
    chatId,
    items,
    dividerIndex,
  );
  const {
    scrollRef,
    contentRef,
    dividerRef,
    atBottom,
    pending,
    loadingOlder,
    handleScroll,
    scrollToBottom,
  } = useMessageListScroll({
    chatId,
    chat,
    storeApi,
    items,
    visibleMessages,
    windowItems,
    reveals,
    hasHidden,
    grow,
    initialUnread,
    draftText,
  });

  // The empty and error views appear only once the first history page has settled.
  if (items.length === 0) {
    if (history === 'loading') {
      return (
        <div className="relative min-h-0 flex-1">
          <MessageListSkeleton />
        </div>
      );
    }
    if (history === 'error') {
      return (
        <div className="relative min-h-0 flex-1">
          <div
            className="chat-background flex h-full flex-col items-center justify-center p-8"
            style={backgroundStyle}
          >
            <StateMessage
              kind="error"
              title="Couldn't load messages"
              action={{ label: 'Retry', onClick: () => storeApi.getState().retryHistory(chat.id) }}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="relative min-h-0 flex-1">
        <div
          className="chat-background flex h-full items-center justify-center p-8 text-center"
          style={backgroundStyle}
        >
          <EmptyChat chat={chat} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <MessageAnnouncer messages={visibleMessages} meId={meId} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list"
        className="chat-background scrollbar-thin h-full overflow-y-auto"
        style={backgroundStyle}
      >
        <div
          ref={contentRef}
          className={`mx-auto flex w-full max-w-[860px] flex-col px-3 pt-4 wide:px-8 wide:pt-6 ${
            chat.topic !== undefined
              ? 'pb-[calc(var(--composer-h,0px)+3.5rem)]'
              : 'pb-[calc(var(--composer-h,0px)+1rem)] wide:pb-[calc(var(--composer-h,0px)+1.5rem)]'
          }`}
        >
          {loadingOlder && (
            <StateMessage kind="loading" title="Loading older messages" size="inline" />
          )}
          {windowItems.map((item, index) => (
            <MessageListRow
              key={messageRowKey(item, draftMessage?.id, draft?.turnId, finishedDraftMessages)}
              item={item}
              index={start + index}
              dividerIndex={dividerIndex}
              dividerRef={dividerRef}
              draftMessageId={draftMessage?.id}
              draftTurnId={draft?.turnId}
              finishedDraftMessages={finishedDraftMessages}
              chat={chat}
              meId={meId}
              meJid={meJid}
              pinId={item.kind === 'separator' ? undefined : pinIdByMessage.get(item.message.id)}
              onReply={handleReply}
              onForward={onForward === undefined ? undefined : handleForward}
              selectionIds={selectedIds}
              onToggleSelect={selection === undefined ? undefined : handleToggleSelect}
              onStartSelect={selection === undefined ? undefined : handleStartSelect}
              selecting={selecting}
            />
          ))}
        </div>
      </div>
      {!atBottom && (
        <IconButton
          aria-label={
            pending > 0 ? `Scroll to bottom, ${pending} new messages` : 'Scroll to bottom'
          }
          onClick={scrollToBottom}
          className="absolute right-4 bottom-[calc(var(--composer-h,0px)+1rem)]"
        >
          <ArrowDown className="size-5" aria-hidden="true" />
          {pending > 0 && <Badge count={pending} className="absolute -top-1 -right-1 px-1" />}
        </IconButton>
      )}
    </div>
  );
});
