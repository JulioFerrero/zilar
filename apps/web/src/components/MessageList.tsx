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
import { scrollToMessage } from '@/lib/scrollToMessage';
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

const WINDOW = 150;
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

interface MessageWindow {
  windowItems: RenderItem[];
  start: number;
  hasHidden: boolean;
  reveals: ReadonlySet<string>;
  grow: () => void;
}

/**
 * The newest `WINDOW` render items, grown to include the divider and any jump
 * target; the forced width is kept so the jump does not shift.
 */
function useMessageWindow(
  chatId: string,
  items: RenderItem[],
  anchorIndex: number | null,
): MessageWindow {
  const reveals = useSyncExternalStore(
    subscribeMessageWindowReveals,
    () => messageWindowReveals(chatId),
    () => NO_REVEALS,
  );
  const [limit, setLimit] = useState(WINDOW);
  // The width a reveal or an older page forced is kept after the reveal clears.
  const [floor, setFloor] = useState(0);

  const start = useMemo(() => {
    let value = Math.max(0, items.length - Math.max(limit, floor));
    const include = (index: number): void => {
      if (index >= 0 && index < value) {
        value = index;
      }
    };
    if (anchorIndex !== null) {
      include(anchorIndex);
    }
    for (const id of reveals) {
      include(items.findIndex((item) => drawsMessage(item, id)));
    }
    return value;
  }, [items, limit, floor, anchorIndex, reveals]);

  // Remember a forced width during render (adjust-state-on-change), guarded so it converges.
  const needed = items.length - start;
  if (needed > floor) {
    setFloor(needed);
  }

  const grow = useCallback(() => setLimit((value) => value + WINDOW), []);

  // Scroll after the layout pass, when the rows are in the DOM.
  const scrolled = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (reveals.size === 0) {
      return;
    }
    let consumed = false;
    for (const id of reveals) {
      if (scrolled.current.has(id)) {
        continue;
      }
      scrolled.current.add(id);
      scrollToMessage(id);
      consumed = true;
    }
    if (consumed) {
      for (const id of reveals) {
        clearMessageWindowReveal(chatId, id);
      }
    }
  }, [chatId, reveals, start]);

  return {
    windowItems: start === 0 ? items : items.slice(start),
    start,
    hasHidden: start > 0,
    reveals,
    grow,
  };
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const scrollMemory = useScrollMemory(chatId, scrollRef, initialUnread === 0, items.length > 0);
  const restoredScroll = useRef(false);
  const previousCount = useRef(visibleMessages.length);
  const prependScrollHeight = useRef<number | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(atBottom);
  const [pending, setPending] = useState(0);
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const stopLoadingOlder = (): void => {
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  };

  // A pending jump target (search, pin, quote) wins over the bottom snap.
  const pendingJump = useRef(reveals.size > 0);
  useInitialScroll(scrollRef, dividerRef, pendingJump, restoredScroll);

  // Compensate for a prepended page before paint so the view does not jump.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    if (!pendingJump.current && !restoredScroll.current && scrollMemory.restore()) {
      restoredScroll.current = true;
      atBottomRef.current = false;
      setAtBottom(false);
      return;
    }
    const added = visibleMessages.length - previousCount.current;
    previousCount.current = visibleMessages.length;
    const previousHeight = prependScrollHeight.current;
    if (previousHeight !== undefined) {
      prependScrollHeight.current = undefined;
      element.scrollTop += element.scrollHeight - previousHeight;
      if (added > 0 && loadingOlderRef.current) {
        stopLoadingOlder();
      }
      return;
    }
    // A restored view sits above the bottom: never snap it back (StrictMode
    // re-runs this effect).
    if (atBottom && !restoredScroll.current) {
      element.scrollTop = element.scrollHeight;
    } else if (added > 0) {
      setPending((value) => value + added);
    }
  }, [windowItems.length, visibleMessages.length, atBottom, scrollMemory]);

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

  // A growing draft pins the bottom only when the reader is already there.
  useEffect(() => {
    if (draftText.length === 0) {
      return;
    }
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    if (atBottom) {
      element.scrollTop = element.scrollHeight;
    }
  }, [draftText, atBottom]);

  // The reveal grows frame by frame, so a resize observer keeps the view pinned.
  const hasContent = items.length > 0;
  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!hasContent || element === null || content === null) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(content, { box: 'border-box' });
    return () => observer.disconnect();
  }, [hasContent]);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearBottom = distance < NEAR_BOTTOM_PX;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
    if (nearBottom) {
      restoredScroll.current = false;
      setPending(0);
    }
    const store = storeApi.getState();
    if (element.scrollTop >= NEAR_BOTTOM_PX || prependScrollHeight.current !== undefined) {
      return;
    }
    // Page the archive only once the window shows every older loaded item.
    if (hasHidden) {
      prependScrollHeight.current = element.scrollHeight;
      grow();
      return;
    }
    if (store.hasMore(chat.id)) {
      if (loadingOlderRef.current) {
        return;
      }
      loadingOlderRef.current = true;
      setLoadingOlder(true);
      prependScrollHeight.current = element.scrollHeight;
      store.loadOlder(chat.id);
    }
  };

  const scrollToBottom = (): void => {
    const element = scrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
    restoredScroll.current = false;
    atBottomRef.current = true;
    setAtBottom(true);
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

// Remembers the scroll anchor per chat for the session only (no storage).

interface ScrollAnchor {
  messageId: string;
  /** Pixels from the viewport top to the anchor message's top. */
  offset: number;
}

/** Module-level so it survives a chat remount; cleared on a full reload. */
const anchors = new Map<string, ScrollAnchor>();

function anchorAt(container: HTMLElement): ScrollAnchor | undefined {
  const top = container.getBoundingClientRect().top;
  for (const row of container.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= top + 1) {
      continue;
    }
    const messageId = row.dataset.messageId;
    return messageId === undefined ? undefined : { messageId, offset: rect.top - top };
  }
  return undefined;
}

function scrollToAnchor(container: HTMLElement, anchor: ScrollAnchor): boolean {
  const element = container.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(anchor.messageId)}"]`,
  );
  if (element === null) {
    return false;
  }
  const containerTop = container.getBoundingClientRect().top;
  container.scrollTop += element.getBoundingClientRect().top - containerTop - anchor.offset;
  return true;
}

interface ScrollMemory {
  restore: () => boolean;
}

function useScrollMemory(
  chatId: string,
  scrollRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  ready: boolean,
): ScrollMemory {
  const attempted = useRef(false);

  const save = useCallback((): void => {
    const container = scrollRef.current;
    if (container === null || !container.isConnected) {
      return;
    }
    const anchor = anchorAt(container);
    if (anchor !== undefined) {
      anchors.set(chatId, anchor);
    }
  }, [chatId, scrollRef]);

  // A rAF throttle keeps the DOM query off the scroll hot path.
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    let frame = 0;
    const onScroll = (): void => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        save();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      save();
    };
  }, [save, ready, scrollRef]);

  const restore = useCallback((): boolean => {
    const container = scrollRef.current;
    if (container === null || attempted.current) {
      return false;
    }
    attempted.current = true;
    if (!enabled) {
      return false;
    }
    const anchor = anchors.get(chatId);
    if (anchor === undefined) {
      return false;
    }
    if (scrollToAnchor(container, anchor)) {
      return true;
    }
    anchors.delete(chatId);
    return false;
  }, [chatId, enabled, scrollRef]);

  return useMemo(() => ({ restore }), [restore]);
}

function useInitialScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  dividerRef: RefObject<HTMLDivElement | null>,
  skip: RefObject<boolean>,
  restored: RefObject<boolean>,
): void {
  useEffect(() => {
    const element = scrollRef.current;
    const divider = dividerRef.current;
    if (element === null || skip.current || restored.current) {
      return;
    }
    if (divider !== null) {
      divider.scrollIntoView({ block: 'center' });
    }
  }, [dividerRef, restored, scrollRef, skip]);
}
