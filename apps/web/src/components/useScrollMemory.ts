// Remembers the scroll anchor per chat for the session only (no storage).
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

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

export interface ScrollMemory {
  restore: () => boolean;
}

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
