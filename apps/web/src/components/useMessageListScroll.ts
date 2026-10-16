// The message list's scroll behaviour: the session anchor, the prepend
// compensation, the loading-older line, the draft pin, the resize observer and
// the bottom snap. Split out of MessageList.tsx, which the size limit had
// frozen (T-1689).
import type { ChatSummary, RenderItem, UiMessage } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useInitialScroll, useScrollMemory } from './useScrollMemory';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const NEAR_BOTTOM_PX = 80;

export interface MessageListScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  dividerRef: RefObject<HTMLDivElement | null>;
  atBottom: boolean;
  pending: number;
  loadingOlder: boolean;
  handleScroll: () => void;
  scrollToBottom: () => void;
}

export function useMessageListScroll({
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
}: {
  chatId: string;
  chat: ChatSummary;
  storeApi: ReturnType<typeof useChatStoreApi>;
  items: RenderItem[];
  visibleMessages: UiMessage[];
  windowItems: RenderItem[];
  reveals: ReadonlySet<string>;
  hasHidden: boolean;
  grow: () => void;
  initialUnread: number;
  draftText: string;
}): MessageListScroll {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  // WUX-28: the session scroll anchor (an unread chat keeps the divider).
  const scrollMemory = useScrollMemory(chatId, scrollRef, initialUnread === 0, items.length > 0);
  const restoredScroll = useRef(false);
  const previousCount = useRef(visibleMessages.length);
  const prependScrollHeight = useRef<number | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(atBottom);
  const [pending, setPending] = useState(0);
  // WUX-11: an older page in flight: the ref guards the scroll handler,
  // the state drives the loading line.
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const stopLoadingOlder = (): void => {
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  };

  // A jump target is pending from the first render (search, pin, reply quote):
  // the window hook draws and scrolls to it, so skip the bottom snap below.
  const pendingJump = useRef(reveals.size > 0);
  useInitialScroll(scrollRef, dividerRef, pendingJump, restoredScroll);

  // WUX-11: compensate for a prepended page before paint so the view
  // stays fixed instead of jumping for a frame.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    // WUX-28: land on the message the reader left once it is drawn; a jump
    // already pending (search, pin, quote) wins, so it is skipped above.
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
      // The older page landed: stop the loading line.
      if (added > 0 && loadingOlderRef.current) {
        stopLoadingOlder();
      }
      return;
    }
    // A restored view sits above the bottom: never snap it back (dev
    // StrictMode re-runs this effect after the restore has already run).
    if (atBottom && !restoredScroll.current) {
      element.scrollTop = element.scrollHeight;
    } else if (added > 0) {
      setPending((value) => value + added);
    }
  }, [windowItems.length, visibleMessages.length, atBottom, scrollMemory]);

  // The loading line also stops when there is nothing left to load.
  const hasMore = useChatSelector((s) => s.hasMore(chatId));
  useEffect(() => {
    if (!hasMore && loadingOlderRef.current) {
      stopLoadingOlder();
    }
  }, [hasMore]);

  // Safety net: a stuck older load must not pin the loading line forever
  // (an Effect fiber per repo rule, no setTimeout).
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

  // A growing draft keeps the view pinned to the bottom only when the user is
  // already there; someone who scrolled up to read is never pulled down.
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

  // The reveal grows the text frame by frame, so the per-event pin above is
  // not enough: the observer keeps the view at the bottom on every height
  // change, as long as the user is there.
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
    observer.observe(content);
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
      // The reader is back at the bottom: the restored spot no longer pins
      // the view, so later height changes may snap it down again.
      restoredScroll.current = false;
      setPending(0);
    }
    const store = storeApi.getState();
    if (element.scrollTop >= NEAR_BOTTOM_PX || prependScrollHeight.current !== undefined) {
      return;
    }
    // Grow the window while older loaded items are hidden; page the archive
    // only once the window shows everything (T-1278).
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

  return {
    scrollRef,
    contentRef,
    dividerRef,
    atBottom,
    pending,
    loadingOlder,
    handleScroll,
    scrollToBottom,
  };
}
