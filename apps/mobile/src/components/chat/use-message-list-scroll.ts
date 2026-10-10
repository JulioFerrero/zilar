import { Effect, Fiber } from 'effect';
import { useEffect, useRef } from 'react';
import type { FlatList } from 'react-native';

import { startJumpScroll } from '@/components/chat/jump-scroll';
import type { ListEntry } from '@/components/chat/message-list-row';
import { runLater } from '@/components/chat/use-stable-handlers';

type JumpTarget = { chatId: string; messageId: string };

type MessageListScrollOptions = {
  chatId: string;
  dividerIndex: number | null;
  jumpTarget: JumpTarget | undefined;
  jumpToMessageId: string | undefined;
  entries: readonly ListEntry[];
  visibleCount: number;
  clearJumpTarget: () => void;
  onJumped: (() => void) | undefined;
};

/**
 * The message list's scroll behaviour (moved unchanged from `message-list.tsx`):
 * it keeps the bottom pinned on new messages, loads older messages near the top,
 * and jumps to a message (a search hit or a pin jump).
 */
export function useMessageListScroll({
  chatId,
  dividerIndex,
  jumpTarget,
  jumpToMessageId,
  entries,
  visibleCount,
  clearJumpTarget,
  onJumped,
}: MessageListScrollOptions) {
  const listRef = useRef<FlatList<ListEntry>>(null);
  const previousCount = useRef(visibleCount);
  // True while the user is at (or near) the bottom, so a growing draft or a new
  // message keeps the view pinned; someone reading older messages is not moved.
  const atBottomRef = useRef(true);

  // Scroll after mount and again a few times while images and the list settle.
  // A search jump owns the scroll instead: the jump effect below lands on the
  // message, so the mount scroll stays out of its way.
  useEffect(() => {
    if (jumpTarget !== undefined) {
      return;
    }
    const scroll = () => {
      if (dividerIndex !== null) {
        listRef.current?.scrollToIndex({ index: dividerIndex, viewPosition: 0.5, animated: false });
      } else {
        listRef.current?.scrollToEnd({ animated: false });
      }
    };
    scroll();
    const timers = [80, 200, 400, 700].map((ms) => runLater(ms, scroll));
    return () => timers.forEach((timer) => Effect.runSync(Fiber.interrupt(timer)));
  }, [chatId, dividerIndex, jumpTarget]);

  useEffect(() => {
    // A search jump owns the scroll while its target is set; a live message
    // arriving in that window must not yank the view to the bottom.
    if (jumpTarget === undefined && visibleCount > previousCount.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
    previousCount.current = visibleCount;
  }, [visibleCount, jumpTarget]);

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

  return { listRef, atBottomRef };
}
