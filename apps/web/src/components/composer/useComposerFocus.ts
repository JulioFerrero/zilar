import { useEffect, useRef, type RefObject } from 'react';
import { useMediaQuery } from '@/lib/useMediaQuery';

// The Tailwind `wide:` variant is 900px (`--breakpoint-wide`, index.css:16),
// the same query ChatShell uses for its wide layout.
const WIDE_QUERY = '(min-width: 900px)';

let activeTextarea: HTMLTextAreaElement | null = null;

function isEditable(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }
  return element.closest('[role="dialog"], [aria-modal="true"]') !== null;
}

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
}

export function focusComposer(): boolean {
  const textarea = activeTextarea;
  if (textarea === null || !textarea.isConnected || hasOpenDialog()) {
    return false;
  }
  if (document.activeElement !== textarea && isEditable(document.activeElement)) {
    return false;
  }
  textarea.focus();
  return true;
}

export function useComposerFocus(
  chatId: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  focusKey?: string | undefined,
): void {
  const isWide = useMediaQuery(WIDE_QUERY);
  // Read through a ref so the focus effect depends on `chatId` alone: a
  // narrow↔wide resize must not yank focus into the composer.
  const isWideRef = useRef(isWide);
  useEffect(() => {
    isWideRef.current = isWide;
  }, [isWide]);

  useEffect(() => {
    activeTextarea = textareaRef.current;
    return () => {
      if (activeTextarea === textareaRef.current) {
        activeTextarea = null;
      }
    };
  }, [textareaRef]);

  useEffect(() => {
    if (!isWideRef.current || hasOpenDialog() || isEditable(document.activeElement)) {
      return;
    }
    textareaRef.current?.focus();
  }, [chatId, textareaRef]);

  useEffect(() => {
    if (focusKey === undefined) {
      return;
    }
    focusComposer();
  }, [focusKey]);
}
