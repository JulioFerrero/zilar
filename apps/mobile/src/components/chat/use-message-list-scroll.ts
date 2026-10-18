import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { ListEntry } from '@/components/chat/message-list-row';
import { interruptFiber, runLater } from '@zilar/client-core';

const JUMP_SCROLL_RETRY_MS: readonly number[] = [80, 200, 400];

interface JumpScrollTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

// Each retry is a fiber that sleeps; clearing it interrupts the fiber.
const defaultTimers: JumpScrollTimers = {
  setTimeout: (callback, ms) =>
    Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(callback)))),
  clearTimeout: (handle) => {
    interruptFiber(handle as Fiber.Fiber<void>);
  },
};

/** Scrolls now and on each retry delay, confirming on the LAST retry so a
 *  message arriving mid-retry still re-scrolls. */
function startJumpScroll(input: {
  findIndex: () => number;
  scrollToIndex: (index: number) => void;
  onDone: () => void;
  delays?: readonly number[];
  timers?: JumpScrollTimers;
}): () => void {
  const noop = (): void => {};
  if (input.findIndex() === -1) {
    return noop;
  }
  const timers = input.timers ?? defaultTimers;
  const delays = input.delays ?? JUMP_SCROLL_RETRY_MS;
  let cancelled = false;
  const attempt = (confirm: boolean): void => {
    if (cancelled) {
      return;
    }
    const index = input.findIndex();
    if (index !== -1) {
      input.scrollToIndex(index);
      if (confirm) {
        input.onDone();
      }
    }
  };
  attempt(delays.length === 0);
  const handles = delays.map((ms, position) =>
    timers.setTimeout(() => attempt(position === delays.length - 1), ms),
  );
  return () => {
    cancelled = true;
    for (const handle of handles) {
      timers.clearTimeout(handle);
    }
  };
}

type JumpTarget = { chatId: string; messageId: string };

/** How close to the inverted list's bottom (offset 0) still counts as "at the bottom". */
const AT_BOTTOM_THRESHOLD = 40;

/** How many viewports from the list's end the next page is requested. */
const PREFETCH_VIEWPORTS = 3;

/** How long a prefetch waits for its page before retrying once. */
const PREFETCH_RETRY_MS = 1000;

/** Backstop on how many content-size changes a restore may wait for. */
const MAX_RESTORE_CHANGES = 10;

// Per-chat scroll spots, in memory: they survive a chat remount and clear on reload. Used only while the newest message is unchanged.
const savedScroll = new Map<string, { offset: number; newestKey: string | undefined }>();

type MessageListScrollOptions = {
  chatId: string;
  dividerIndex: number | null;
  jumpTarget: JumpTarget | undefined;
  jumpToMessageId: string | undefined;
  entries: readonly ListEntry[];
  newestEntryKey: string | undefined;
  newestEntryOutgoing: boolean;
  hasMore: boolean;
  loadOlder: () => void;
  clearJumpTarget: () => void;
  onJumped: (() => void) | undefined;
};

/**
 * The list is inverted: index 0 is the newest message and offset 0 the bottom.
 * A new message is followed only at the bottom or when it is mine.
 */
export function useMessageListScroll({
  chatId,
  dividerIndex,
  jumpTarget,
  jumpToMessageId,
  entries,
  newestEntryKey,
  newestEntryOutgoing,
  hasMore,
  loadOlder,
  clearJumpTarget,
  onJumped,
}: MessageListScrollOptions) {
  const listRef = useRef<FlatList<ListEntry>>(null);
  const previousNewestKey = useRef(newestEntryKey);
  // True near the bottom, so a growing draft or a new message keeps the view pinned.
  const atBottomRef = useRef(true);
  // Stays set across content-size changes: `maintainVisibleContentPosition` can move the offset away from 0 after the first scroll, so `handleContentSizeChange` re-pins until the row settles.
  const followNewest = useRef(false);
  // The last offset, to tell a deliberate scroll away from the follow's animated scroll toward 0.
  const lastOffset = useRef(0);
  // The offset the restore last asked for, to tell the reader's scroll from the restore's.
  const requestedOffset = useRef(0);
  // Content height and change count at the last restore, to end it once the list stops growing.
  const lastRestoreHeight = useRef(0);
  const restoreChanges = useRef(0);
  // Viewport height: the list only reaches `contentHeight - viewportHeight`, so content that merely passes the saved offset still clamps short.
  const viewportHeight = useRef(0);
  // The ref tracks every scroll; the button re-renders only when this boolean flips.
  const [atBottom, setAtBottomState] = useState(true);
  // New newest keys that arrived while scrolled up; cleared at the bottom.
  const [unseenCount, setUnseenCount] = useState(0);
  // Content height at the last change, to tell when the reader is near the end and the next page is prefetched.
  const contentHeight = useRef(0);
  // The prefetch in flight: the height it started at, whether it is pending, and its retry timer.
  const prefetchHeight = useRef(0);
  const prefetchPending = useRef(false);
  const prefetchTimer = useRef<Fiber.Fiber<void> | undefined>(undefined);
  // Latest props, so the retry timer reads live values without re-creating itself.
  const hasMoreRef = useRef(hasMore);
  const loadOlderRef = useRef(loadOlder);
  // Whether mount lands on the saved spot: only for a read chat with no pending jump and no newer message.
  const restorePending = useRef(
    savedScroll.has(chatId) &&
      dividerIndex === null &&
      jumpTarget === undefined &&
      jumpToMessageId === undefined &&
      savedScroll.get(chatId)?.newestKey === newestEntryKey,
  );

  // Whether the reader scrolled since mount; a chat reopened without a scroll keeps its saved spot.
  const scrolledSinceMount = useRef(false);

  // Record the spot on leave; the bottom is the default and is not saved.
  useEffect(() => {
    return () => {
      if (!scrolledSinceMount.current) {
        return;
      }
      // A running restore clamps the list, so that offset is not the reader's; keep the saved entry.
      if (restorePending.current) {
        return;
      }
      if (lastOffset.current >= AT_BOTTOM_THRESHOLD) {
        savedScroll.set(chatId, {
          offset: lastOffset.current,
          newestKey: previousNewestKey.current,
        });
      } else {
        savedScroll.delete(chatId);
      }
    };
  }, [chatId]);

  const setAtBottom = useCallback((next: boolean) => {
    if (atBottomRef.current === next) {
      return;
    }
    atBottomRef.current = next;
    setAtBottomState(next);
    if (next) {
      setUnseenCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // The retry timer reads current props; a chat switch or unmount drops a waiting prefetch.
  useEffect(() => {
    hasMoreRef.current = hasMore;
    loadOlderRef.current = loadOlder;
  }, [hasMore, loadOlder]);
  useEffect(() => {
    return () => {
      interruptFiber(prefetchTimer.current);
      prefetchTimer.current = undefined;
      prefetchPending.current = false;
    };
  }, [chatId]);

  // One page ahead: within `PREFETCH_VIEWPORTS` of the end, and again when a landing page leaves the reader there. A page that never grows the content is retried once, because `VirtualizedList` re-arms `onEndReached` only on a scroll.
  const maybePrefetch = useCallback(() => {
    if (!hasMoreRef.current || prefetchPending.current) {
      return;
    }
    const viewport = viewportHeight.current;
    const height = contentHeight.current;
    if (viewport <= 0 || height <= 0) {
      return;
    }
    if (height - viewport - lastOffset.current > PREFETCH_VIEWPORTS * viewport) {
      return;
    }
    prefetchPending.current = true;
    prefetchHeight.current = height;
    const check = (retry: boolean): void => {
      interruptFiber(prefetchTimer.current);
      prefetchTimer.current = runLater(PREFETCH_RETRY_MS, () => {
        prefetchTimer.current = undefined;
        if (!prefetchPending.current || !hasMoreRef.current) return;
        if (contentHeight.current > prefetchHeight.current) return;
        if (!retry) {
          prefetchPending.current = false;
          return;
        }
        prefetchHeight.current = contentHeight.current;
        loadOlderRef.current();
        check(false);
      });
    };
    check(true);
    loadOlderRef.current();
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      viewportHeight.current = event.nativeEvent.layoutMeasurement.height;
      scrolledSinceMount.current = true;
      // A reader who scrolls during a restore takes over: only a jump past the offset we asked for counts.
      if (restorePending.current && offset > requestedOffset.current + AT_BOTTOM_THRESHOLD) {
        restorePending.current = false;
      }
      // A scroll away from the bottom disarms the follow; the direction check keeps the follow's own shrink toward 0 from disarming it.
      if (offset >= AT_BOTTOM_THRESHOLD && offset > lastOffset.current) {
        followNewest.current = false;
      }
      lastOffset.current = offset;
      setAtBottom(offset < AT_BOTTOM_THRESHOLD);
      maybePrefetch();
    },
    [maybePrefetch, setAtBottom],
  );

  // Runs once content settles: lands on the saved spot, repeating until content plus viewport covers it (an early scroll is clamped short) or the list stops growing. The follow flag is not cleared here: a content-size change can fire before the inserted row renders.
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (prefetchPending.current && height > prefetchHeight.current) {
        prefetchPending.current = false;
        interruptFiber(prefetchTimer.current);
        prefetchTimer.current = undefined;
      }
      contentHeight.current = height;
      if (restorePending.current) {
        const saved = savedScroll.get(chatId);
        if (saved === undefined) {
          restorePending.current = false;
          maybePrefetch();
          return;
        }
        requestedOffset.current = saved.offset;
        listRef.current?.scrollToOffset({ offset: saved.offset, animated: false });
        setAtBottom(false);
        restoreChanges.current += 1;
        const reachable = viewportHeight.current > 0 ? height - viewportHeight.current : -1;
        if (
          reachable >= saved.offset ||
          height <= lastRestoreHeight.current ||
          restoreChanges.current >= MAX_RESTORE_CHANGES
        ) {
          restorePending.current = false;
        } else {
          lastRestoreHeight.current = height;
        }
        maybePrefetch();
        return;
      }
      if (followNewest.current) {
        scrollToBottom();
      }
      maybePrefetch();
    },
    [chatId, maybePrefetch, scrollToBottom, setAtBottom],
  );

  // No divider: the inverted list starts at offset 0. With a divider, one `scrollToIndex` lands on it, and `onScrollToIndexFailed` handles one not rendered yet. A search jump owns the scroll instead.
  useEffect(() => {
    if (jumpTarget !== undefined || dividerIndex === null) {
      return;
    }
    listRef.current?.scrollToIndex({ index: dividerIndex, viewPosition: 0.5, animated: false });
  }, [chatId, dividerIndex, jumpTarget]);

  useEffect(() => {
    // A pending search jump cancels a follow. Scrolling keys on the newest entry, so loading older pages never moves the view. My own message never counts as unseen.
    if (jumpTarget !== undefined) {
      followNewest.current = false;
    } else if (newestEntryKey !== previousNewestKey.current) {
      followNewest.current = false;
      restorePending.current = false;
      if (atBottomRef.current || newestEntryOutgoing) {
        followNewest.current = true;
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      } else {
        setUnseenCount((current) => current + 1);
      }
    }
    previousNewestKey.current = newestEntryKey;
  }, [newestEntryKey, newestEntryOutgoing, jumpTarget]);

  // Scrolls to the loaded search target (centered), re-resolving its index on every retry: a message arriving within 400 ms moves every row below, so a captured index would be stale.
  const jumpMessageId = jumpTarget?.messageId;
  useEffect(() => {
    if (jumpMessageId === undefined) {
      return;
    }
    return startJumpScroll({
      findIndex: () =>
        entries.findIndex(
          (entry) => entry.type === 'message' && entry.item.message.id === jumpMessageId,
        ),
      scrollToIndex: (index) =>
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }),
      onDone: clearJumpTarget,
    });
  }, [jumpMessageId, entries, clearJumpTarget]);

  // Scrolls to the pinned bubble once it renders; only when the message is loaded.
  useEffect(() => {
    if (jumpToMessageId === undefined) {
      return;
    }
    const index = entries.findIndex(
      (entry) => entry.type === 'message' && entry.item.message.id === jumpToMessageId,
    );
    if (index === -1) {
      return;
    }
    const timer = runLater(100, () => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      onJumped?.();
    });
    return () => Effect.runSync(Fiber.interrupt(timer));
  }, [jumpToMessageId, entries, onJumped]);

  return { listRef, atBottom, unseenCount, handleScroll, handleContentSizeChange };
}
