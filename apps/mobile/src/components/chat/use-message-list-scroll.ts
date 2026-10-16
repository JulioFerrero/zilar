import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { startJumpScroll } from '@/components/chat/jump-scroll';
import type { ListEntry } from '@/components/chat/message-list-row';
import { runLater } from '@/lib/effect/timers';

type JumpTarget = { chatId: string; messageId: string };

/** How close to the inverted list's bottom (offset 0) still counts as "at the bottom". */
const AT_BOTTOM_THRESHOLD = 40;

/** Backstop on how many content-size changes a restore may wait for. */
const MAX_RESTORE_CHANGES = 10;

// The spot the reader left each chat at, keyed by chat id (WUX-28 parity). In
// memory only, so it survives a chat remount and clears on a full reload, like
// web's scroll anchors. It is used only while the newest message is unchanged.
const savedScroll = new Map<string, { offset: number; newestKey: string | undefined }>();

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
  // The offset our own restore last asked the list to show, so `handleScroll` can
  // tell the reader's scroll apart from the restore's.
  const requestedOffset = useRef(0);
  // The content height at the last restore change, so the restore can end once
  // the list stops growing, and how many changes it has waited through, as a
  // backstop for a chat whose content never covers the saved offset.
  const lastRestoreHeight = useRef(0);
  const restoreChanges = useRef(0);
  // The viewport height, from the last scroll event, so the restore can tell
  // whether the content is tall enough to show the saved offset: a list only
  // reaches `contentHeight - viewportHeight`, so content that merely passes the
  // saved offset still clamps the scroll short.
  const viewportHeight = useRef(0);
  // The ref above tracks every scroll event; the jump-to-bottom button only
  // re-renders when the boolean flips, so the state is updated through this
  // helper rather than on every scroll.
  const [atBottom, setAtBottomState] = useState(true);
  // New newest-entry keys that arrived while the user was scrolled up; the jump
  // button shows the count and it clears once the user is back at the bottom.
  const [unseenCount, setUnseenCount] = useState(0);
  // Whether the mount should land on this chat's saved spot. Computed once at
  // mount: a saved spot wins only for a read chat (no divider) with no pending
  // jump and no newer message than the one saved with it.
  const restorePending = useRef(
    savedScroll.has(chatId) &&
      dividerIndex === null &&
      jumpTarget === undefined &&
      jumpToMessageId === undefined &&
      savedScroll.get(chatId)?.newestKey === newestEntryKey,
  );

  // Whether the reader has scrolled since the chat mounted, so a chat reopened
  // and left again without any scroll keeps its saved spot instead of clearing it.
  const scrolledSinceMount = useRef(false);

  // Records the chat's spot when the reader leaves it, so reopening the chat can
  // land there. A spot at the bottom is not saved: the bottom is the default.
  useEffect(() => {
    return () => {
      if (!scrolledSinceMount.current) {
        return;
      }
      // While a restore is still running the list has only been clamped to a
      // partial offset, so that scroll is not the spot the reader chose; keep
      // the saved entry instead of overwriting it with the intermediate offset.
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
    // The inverted list's bottom is offset 0.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      viewportHeight.current = event.nativeEvent.layoutMeasurement.height;
      scrolledSinceMount.current = true;
      // A reader who starts scrolling during a restore takes over, so the
      // restore stops instead of pulling them back. The list clamps our own
      // restore scroll while the content is shorter than the saved offset, so
      // only a jump past the offset we asked for is the reader's; a landing
      // short of it is our own clamped scroll.
      if (restorePending.current && offset > requestedOffset.current + AT_BOTTOM_THRESHOLD) {
        restorePending.current = false;
      }
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

  // Runs once content has settled. It lands on the chat's saved spot (WUX-28)
  // when the mount armed a restore, repeating on every content-size change until
  // it ends: the content plus the viewport covers the saved offset — a FlatList
  // renders only its first batch of rows before the first change, so an early
  // scroll is clamped short — or the list stops growing (it drew all it will,
  // e.g. older messages were dropped between visits) or 10 changes have passed,
  // so a shorter chat cannot keep pulling the reader back up. It otherwise
  // finishes a follow that `maintainVisibleContentPosition` may have interrupted.
  // The follow flag is not cleared here: any content-size change (an image
  // finishing, the keyboard settling) can fire before the inserted row renders,
  // and clearing on it would leave the follow unfinished. It is disarmed when the
  // user scrolls away or a newer entry arrives.
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (restorePending.current) {
        const saved = savedScroll.get(chatId);
        if (saved === undefined) {
          restorePending.current = false;
          return;
        }
        requestedOffset.current = saved.offset;
        listRef.current?.scrollToOffset({ offset: saved.offset, animated: false });
        setAtBottom(false);
        restoreChanges.current += 1;
        // The restore ends once the content plus the viewport can show the saved
        // offset — a list only reaches `height - viewportHeight`, so content
        // that merely passes the offset still clamps the scroll short — or the
        // list stops growing (it drew all it will, e.g. older messages were
        // dropped between visits) or the backstop is hit, so a shorter chat
        // cannot keep pulling the reader back up. With no viewport measured yet
        // the reachable offset is unknown, so the restore waits instead of
        // ending early on a height that understates what the list can show.
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
        return;
      }
      if (!followNewest.current) {
        return;
      }
      scrollToBottom();
    },
    [chatId, scrollToBottom, setAtBottom],
  );

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
      // A message that arrived during the restore window takes over, so the
      // restore does not fight the follow (or the unseen badge).
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
