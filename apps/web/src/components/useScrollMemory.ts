// WUX-28: remembers where the reader left each chat for the session, so
// reopening a chat lands on the same message instead of the divider or the
// bottom. The anchor is the id of the message at the top of the view and its
// pixel offset from the viewport top; it lives in memory only (no storage).
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

interface ScrollAnchor {
  messageId: string;
  /** Pixels from the top of the scroll viewport to the anchor message's top. */
  offset: number;
}

/** Module-level so it survives a chat remount; cleared on a full reload. */
const anchors = new Map<string, ScrollAnchor>();

/** The message whose bubble crosses the top edge of the scroll viewport. */
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

/** Puts the remembered message back at its offset; false when it is not drawn. */
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

export interface ScrollMemory {
  /** Restores the chat's saved spot once the rows are drawn; false otherwise. */
  restore: () => boolean;
}

/**
 * Restores and records the scroll anchor for one chat. `enabled` is false for a
 * chat with unread messages, which keeps the divider behaviour; `ready` gates
 * the scroll listener on the first drawn row.
 */
export function useScrollMemory(
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

  // A rAF throttle keeps the DOM query off the scroll hot path; the cleanup
  // records the last position so switching chats remembers it.
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

/**
 * The initial scroll of a chat list (WUX-28): centres the unread divider; with
 * no divider the list's layout effect snaps to the bottom. Skipped while a jump
 * is pending or a restored view is pinned.
 */
export function useInitialScroll(
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
