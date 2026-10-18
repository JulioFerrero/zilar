import type { RenderItem } from '@zilar/chat-core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { scrollToMessage } from '@/lib/scrollToMessage';
import {
  clearMessageWindowReveal,
  messageWindowReveals,
  subscribeMessageWindowReveals,
} from '@/store/effects/history';

export const WINDOW = 150;

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

export interface MessageWindow {
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
