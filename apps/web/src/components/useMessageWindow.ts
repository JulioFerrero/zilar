// PERF-3: draws only the newest part of a chat's loaded render items, so a
// long chat neither keeps every bubble in the DOM nor re-renders all of them on
// every store tick. The window grows by one step when the reader reaches the
// top; the list pages the archive only once the window shows everything.
import type { RenderItem } from '@zilar/chat-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { scrollToMessage } from '@/lib/scrollToMessage';
import {
  clearMessageWindowReveal,
  messageWindowReveals,
  subscribeMessageWindowReveals,
} from '@/store/effects/history';

/** How many render items the window shows before the reader grows it. */
export const WINDOW = 150;

/** No ids: the stable empty set the reveal reader returns for a chat with none. */
const NO_REVEALS: ReadonlySet<string> = new Set();

/** Whether one render item draws the message with this id (an album draws its members). */
function drawsMessage(item: RenderItem, id: string): boolean {
  if (item.kind === 'message') {
    return item.message.id === id;
  }
  if (item.kind === 'album') {
    return item.messages.some((message) => message.id === id);
  }
  return false;
}

export interface MessageWindow {
  /** The newest window of render items to draw. */
  windowItems: RenderItem[];
  /** The index in `items` the window starts at; a row's index is `start` + its place. */
  start: number;
  /** True while loaded items are hidden above the window. */
  hasHidden: boolean;
  /** The jump targets the window had to grow to include. */
  reveals: ReadonlySet<string>;
  /** Widens the window by one WINDOW; the caller compensates the scroll. */
  grow: () => void;
}

/**
 * The newest `WINDOW` render items, grown to include the unread divider
 * (`anchorIndex`) and any jump target the store recorded (a search hit, a pin,
 * a reply quote). Once the target is drawn the hook scrolls to it and forgets
 * the reveal; the width it forced is kept, so the jump's position stays put.
 */
export function useMessageWindow(
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
  // The width a reveal or an older page forced: kept after the reveal is
  // cleared so the position the jump scrolled to does not shift again.
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

  // A reveal or the divider can force a window wider than the base size:
  // remember that width during render (React's adjust-state-on-change pattern)
  // so dropping the reveal keeps the window open. Guarded, so it converges.
  const needed = items.length - start;
  if (needed > floor) {
    setFloor(needed);
  }

  const grow = useCallback(() => setLimit((value) => value + WINDOW), []);

  // Once the targets are drawn, scroll to them and forget the reveals; the
  // kept width above holds the window open. Runs after the layout pass, so the
  // rows are in the DOM (and the list's mount scroll already skipped).
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
