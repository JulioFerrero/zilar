import { AiBadge } from './AiBadge';
import { EntityAvatar } from './EntityAvatar';
import { MessageListRow, messageRowKey } from './MessageListRow';
import { MessageListSkeleton } from './Skeleton';
import { Badge } from './ui/badge';
import { IconButton } from './ui/icon-button';
import { StateMessage } from './ui/state-message';
import { listAis, listConnections, type AiTemplate } from '@/lib/api';
import { useBlockedJids } from '@/lib/blockedJids';
import { chatBackgroundStyle, effectiveBackground } from '@/lib/chatBackground';
import { dmContactFor } from '@/lib/contacts';
import { useQuery } from '@/lib/effect/use-query';
import { registerMessageList, scrollToMessage } from '@/lib/scrollToMessage';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  clearMessageWindowReveal,
  messageWindowReveals,
  subscribeMessageWindowReveals,
} from '@/store/effects/history';
import {
  aiSuggestions,
  groupMessages,
  providerLabel,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
  type RenderItem,
  isBlockedSender,
} from '@zilar/chat-core';
import { fromApi } from '@zilar/client-core';
import { Effect, Fiber } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { ArrowDown } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { VList, type VListHandle } from 'virtua';
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

const NEAR_BOTTOM_PX = 80;

const NO_REVEALS: ReadonlySet<string> = new Set();

function drawsMessage(item: RenderItem, id: string): boolean {
  if (item.kind === 'message') {
    return item.message.id === id;
  }
  if (item.kind === 'album') {
    return item.messages.some((message) => message.id === id);
  }
  return false;
}

/** The id the scroll memory stores: a message row or a date separator. */
function anchorId(item: RenderItem): string {
  return item.kind === 'separator' ? item.id : item.message.id;
}

/** A prepend always brings a new first message, even when the day separator stays. */
function firstMessageId(items: readonly RenderItem[]): string | undefined {
  return items.find((item) => item.kind !== 'separator')?.message.id;
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
  const reveals = useSyncExternalStore(
    subscribeMessageWindowReveals,
    () => messageWindowReveals(chatId),
    () => NO_REVEALS,
  );
  const listRef = useRef<VListHandle>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // No scroll has been chosen yet, so an early scroll event must not overwrite the memory.
  const scrollReady = useRef(false);
  const previous = useRef<{ length: number; first: string | undefined } | null>(null);
  const scrollMemory = useScrollMemory(chatId, listRef, items, scrollReady);
  const [atBottom, setAtBottom] = useState(initialUnread === 0);
  const atBottomRef = useRef(atBottom);
  const [pending, setPending] = useState(0);
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [prependFrom, setPrependFrom] = useState<string | undefined>(undefined);
  // Virtua shifts only when the first message actually changed, not for a message appended mid-load.
  const shift = loadingOlder && firstMessageId(items) !== prependFrom;
  const stopLoadingOlder = (): void => {
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  };
  // The ref stays synchronous for scroll logic; the state update is deferred so an effect
  // never sets state synchronously.
  const markAtBottom = (value: boolean): void => {
    atBottomRef.current = value;
    queueMicrotask(() => setAtBottom(value));
  };

  // A pending jump target (search, pin, quote) wins over the initial position.
  const pendingJump = useRef(reveals.size > 0);

  // The first target is re-applied until row sizes go quiet; virtua opens on estimates.
  const settle = useRef<ScrollTarget | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startSettle = (target: ScrollTarget): void => {
    settle.current = target;
    target.apply();
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => (settle.current = null), 400);
  };
  const cancelSettle = (): void => {
    settle.current = null;
    clearTimeout(settleTimer.current);
  };
  useEffect(() => () => cancelSettle(), []);

  useLayoutEffect(() => {
    const handle = listRef.current;
    if (handle === null || visibleMessages.length === 0) {
      return;
    }
    const first = firstMessageId(items);
    const before = previous.current;
    previous.current = { length: visibleMessages.length, first };
    if (before === null) {
      scrollReady.current = true;
      if (pendingJump.current || reveals.size > 0) {
        markAtBottom(false);
        return;
      }
      const target =
        scrollMemory.restore() ??
        (dividerIndex === null
          ? { bottom: true, apply: () => handle.scrollTo(handle.scrollSize) }
          : { bottom: false, apply: () => handle.scrollToIndex(dividerIndex, { align: 'start' }) });
      markAtBottom(target.bottom);
      startSettle(target);
      return;
    }
    const prepended =
      visibleMessages.length > before.length &&
      before.first !== undefined &&
      before.first !== first;
    const added = prepended ? 0 : Math.max(0, visibleMessages.length - before.length);
    if (prepended) {
      if (loadingOlderRef.current) queueMicrotask(stopLoadingOlder);
      return;
    }
    if (added === 0) return;
    if (atBottomRef.current) handle.scrollTo(handle.scrollSize);
    else queueMicrotask(() => setPending((value) => value + added));
  }, [visibleMessages, items, dividerIndex, reveals, scrollMemory]);

  const hasMore = useChatSelector((s) => s.hasMore(chatId));
  useEffect(() => {
    if (!hasMore && loadingOlderRef.current) {
      stopLoadingOlder();
    }
  }, [hasMore]);

  // A stuck older load must not pin the loading line forever.
  useEffect(() => {
    if (!loadingOlder) {
      return;
    }
    const timer = Effect.runFork(
      Effect.sleep(8000).pipe(Effect.andThen(Effect.sync(stopLoadingOlder))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(timer));
    };
  }, [loadingOlder]);

  // Virtua re-measures a row when its content changes, so pinning here keeps a growing
  // draft and the AI reveal at the bottom without observing the DOM.
  const handleResize = (): void => {
    const handle = listRef.current;
    if (handle === null) return;
    const target = settle.current;
    if (target !== null) startSettle(target);
    else if (atBottomRef.current) handle.scrollTo(handle.scrollSize);
  };

  // The list can jump to a row it has not drawn yet; reachable before the reveal effect runs.
  useLayoutEffect(
    () =>
      registerMessageList((messageId) => {
        cancelSettle();
        const handle = listRef.current;
        const index = itemsRef.current.findIndex((item) => drawsMessage(item, messageId));
        if (handle === null || index < 0) return false;
        handle.scrollToIndex(index, { align: 'center' });
        return true;
      }),
    [],
  );

  useEffect(() => {
    if (reveals.size === 0) return;
    for (const id of reveals) {
      if (scrollToMessage(id)) clearMessageWindowReveal(chatId, id);
    }
  }, [chatId, reveals, items]);

  const handleScroll = (offset: number): void => {
    const handle = listRef.current;
    if (handle === null) return;
    const target = settle.current;
    if (target !== null) {
      markAtBottom(target.bottom);
      return;
    }
    const nearBottom = handle.scrollSize - offset - handle.viewportSize < NEAR_BOTTOM_PX;
    markAtBottom(nearBottom);
    if (nearBottom) setPending(0);
    scrollMemory.save();
    if (!scrollReady.current || offset >= NEAR_BOTTOM_PX || !hasMore || loadingOlderRef.current)
      return;
    loadingOlderRef.current = true;
    setPrependFrom(firstMessageId(items));
    setLoadingOlder(true);
    storeApi.getState().loadOlder(chat.id);
  };

  const scrollToBottom = (): void => {
    cancelSettle();
    const handle = listRef.current;
    if (handle !== null) handle.scrollTo(handle.scrollSize);
    markAtBottom(true);
    setPending(0);
  };

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
      <VList
        ref={listRef}
        data={items}
        shift={shift}
        data-testid="message-list"
        className={`chat-background scrollbar-thin pt-4 wide:pt-6 ${
          chat.topic !== undefined
            ? 'pb-[calc(var(--composer-h,0px)+3.5rem)]'
            : 'pb-[calc(var(--composer-h,0px)+1rem)] wide:pb-[calc(var(--composer-h,0px)+1.5rem)]'
        }`}
        style={backgroundStyle}
        onScroll={handleScroll}
        onResize={handleResize}
      >
        {(item, index) => (
          <div
            key={messageRowKey(item, draftMessage?.id, draft?.turnId, finishedDraftMessages)}
            className="mx-auto w-full max-w-[860px] px-3 wide:px-8"
          >
            <MessageListRow
              item={item}
              index={index}
              dividerIndex={dividerIndex}
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
          </div>
        )}
      </VList>
      {loadingOlder && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <StateMessage kind="loading" title="Loading older messages" size="inline" />
        </div>
      )}
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

// Remembers the scroll anchor per chat for the session only (no storage).

interface ScrollAnchor {
  messageId: string;
  /** Pixels from the viewport top to the anchor row's top. */
  offset: number;
  /** The reader was at the bottom, so reopening should land there. */
  bottom: boolean;
}

/** Module-level so it survives a chat remount; cleared on a full reload. */
const anchors = new Map<string, ScrollAnchor>();

interface ScrollTarget {
  bottom: boolean;
  apply: () => void;
}

interface ScrollMemory {
  save: () => void;
  restore: () => ScrollTarget | undefined;
}

function useScrollMemory(
  chatId: string,
  listRef: RefObject<VListHandle | null>,
  items: readonly RenderItem[],
  ready: RefObject<boolean>,
): ScrollMemory {
  const remember = useLatestCallback((): void => {
    const handle = listRef.current;
    if (handle === null || !ready.current || items.length === 0) return;
    const index = Math.min(
      Math.max(handle.findItemIndex(handle.scrollOffset), 0),
      items.length - 1,
    );
    const item = items[index];
    if (item === undefined) return;
    anchors.set(chatId, {
      messageId: anchorId(item),
      offset: handle.getItemOffset(index) - handle.scrollOffset,
      bottom: handle.scrollSize - handle.scrollOffset - handle.viewportSize < NEAR_BOTTOM_PX,
    });
  });
  const save = useCallback((): void => remember(), [remember]);
  // The last scroll already saved it; this catches a switch while the view is still.
  useEffect(() => () => save(), [save]);
  const restore = useCallback((): ScrollTarget | undefined => {
    const handle = listRef.current;
    const anchor = anchors.get(chatId);
    if (handle === null || anchor === undefined) return undefined;
    if (anchor.bottom)
      return { bottom: true, apply: () => listRef.current?.scrollTo(listRef.current.scrollSize) };
    const index = items.findIndex((item) => anchorId(item) === anchor.messageId);
    if (index < 0) {
      anchors.delete(chatId);
      return undefined;
    }
    return {
      bottom: false,
      apply: () =>
        listRef.current?.scrollToIndex(index, { align: 'start', offset: -anchor.offset }),
    };
  }, [chatId, items, listRef]);

  return useMemo(() => ({ save, restore }), [save, restore]);
}
