import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { startJumpScroll } from '@/components/chat/jump-scroll';
import type { ListEntry } from '@/components/chat/message-list-row';
import { runLater } from '@/lib/effect/timers';

type JumpTarget = { chatId: string; messageId: string };

/** How close to the inverted list's bottom (offset 0) still counts as "at the bottom". */
const AT_BOTTOM_THRESHOLD = 40;

type MessageListScrollOptions = {
  chatId: string;
  dividerIndex: number | null;
  jumpTarget: JumpTarget | undefined;
  jumpToMessageId: string | undefined;
  /** The reversed entries: index 0 is the newest message (inverted list). */
  entries: readonly ListEntry[];
  newestEntryKey: string | undefined;
  newestEntryOutgoing: boolean;
  clearJumpTarget: () => void;
  onJumped: (() => void) | undefined;
};

/**
 * The message list's scroll behaviour. The list is inverted, so index 0 is the
 * newest message at the bottom and offset 0 is the bottom. The hook lands on the
 * unread divider at mount, follows a new message only when the user is at the
 * bottom or the message is mine, and jumps to a message (a search hit or a pin
 * jump). Older pages load through the list's `onEndReached`, not here.
 */
export function useMessageListScroll({
  chatId,
  dividerIndex,
  jumpTarget,
  jumpToMessageId,
  entries,
  newestEntryKey,
  newestEntryOutgoing,
  clearJumpTarget,
  onJumped,
}: MessageListScrollOptions) {
  const listRef = useRef<FlatList<ListEntry>>(null);
  const previousNewestKey = useRef(newestEntryKey);
  // True while the user is at (or near) the bottom, so a growing draft or a new
  // message keeps the view pinned; someone reading older messages is not moved.
  const atBottomRef = useRef(true);
  // Set when a new newest entry should be followed. It stays set across
  // content-size changes: `maintainVisibleContentPosition` re-anchors the view
  // when a row is inserted at index 0 (the inverted list's bottom) and can move
  // the offset away from 0 after the first scroll, so `handleContentSizeChange`
  // re-pins until the row has settled. It is disarmed only when the user scrolls
  // away from the bottom (`handleScroll`) or a newer entry arrives (the effect
  // below), never by an unrelated size change.
  const followNewest = useRef(false);
  // The last scroll offset, so `handleScroll` can tell a deliberate scroll away
  // (offset growing) from the follow's own animated scroll toward offset 0.
  const lastOffset = useRef(0);
  // The ref above tracks every scroll event; the jump-to-bottom button only
  // re-renders when the boolean flips, so the state is updated through this
  // helper rather than on every scroll.
  const [atBottom, setAtBottomState] = useState(true);
  // New newest-entry keys that arrived while the user was scrolled up; the jump
  // button shows the count and it clears once the user is back at the bottom.
  const [unseenCount, setUnseenCount] = useState(0);

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
    // The inverted list's bottom is offset 0.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      // A deliberate scroll away from the bottom disarms a pending follow, so a
      // later content-size change cannot yank the user back down. The direction
      // check keeps the follow's own animated scroll (offset shrinking toward 0)
      // from disarming it.
      if (offset >= AT_BOTTOM_THRESHOLD && offset > lastOffset.current) {
        followNewest.current = false;
      }
      lastOffset.current = offset;
      setAtBottom(offset < AT_BOTTOM_THRESHOLD);
    },
    [setAtBottom],
  );

  // Runs once content has settled. It finishes a follow that
  // `maintainVisibleContentPosition` may have interrupted. The flag is not
  // cleared here: any content-size change (an image finishing, the keyboard
  // settling) can fire before the inserted row renders, and clearing on it would
  // leave the follow unfinished. It is disarmed when the user scrolls away or a
  // newer entry arrives.
  const handleContentSizeChange = useCallback(() => {
    if (!followNewest.current) {
      return;
    }
    scrollToBottom();
  }, [scrollToBottom]);

  // A chat with no unread divider opens at the bottom (offset 0) with no scroll
  // at all, because the inverted list starts there. With a divider, one
  // `scrollToIndex` lands on it; the list's `onScrollToIndexFailed` handles a
  // divider that is not rendered yet. A search jump owns the scroll instead: the
  // jump effect below lands on the message, so this scroll stays out of its way.
  useEffect(() => {
    if (jumpTarget !== undefined || dividerIndex === null) {
      return;
    }
    listRef.current?.scrollToIndex({ index: dividerIndex, viewPosition: 0.5, animated: false });
  }, [chatId, dividerIndex, jumpTarget]);

  useEffect(() => {
    // A search jump owns the scroll while its target is set; a live message
    // arriving in that window must not yank the view to the bottom, so a pending
    // follow is cancelled. Scrolling is keyed on the newest entry changing, so
    // loading an older page (the newest key stays) never moves the view. A new
    // newest message is followed when the user is at the bottom or the message is
    // mine; otherwise it is counted for the jump-to-bottom badge (MUX-8). My own
    // message never takes the count branch, so it is not counted as unseen.
    if (jumpTarget !== undefined) {
      followNewest.current = false;
    } else if (newestEntryKey !== previousNewestKey.current) {
      // Disarm the previous follow, then re-arm only when this entry is followed.
      followNewest.current = false;
      if (atBottomRef.current || newestEntryOutgoing) {
        followNewest.current = true;
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      } else {
        setUnseenCount((current) => current + 1);
      }
    }
    previousNewestKey.current = newestEntryKey;
  }, [newestEntryKey, newestEntryOutgoing, jumpTarget]);

  // A search hit lands here: once the jump target's message is loaded, scroll
  // to it (centered) and confirm the target on the LAST retry so a later
  // message with the same id does not re-scroll. `startJumpScroll`
  // re-resolves the index on every retry: a message arriving within 400 ms
  // of the jump moves every row below it, so a captured index would scroll
  // to a stale row — and confirming early would clear the target before the
  // retries could follow it (T-0147).
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

  // A pin jump scrolls to the target bubble once it renders. Only fires
  // when the message is loaded (the banner shows "Message not found" when
  // it is not — mobile has no history paging yet).
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
