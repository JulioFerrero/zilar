import { useEffect, useRef, type RefObject } from 'react';
import { useMediaQuery } from '@/lib/useMediaQuery';

// The Tailwind `wide:` variant is 900px (`--breakpoint-wide`, index.css:16),
// the same query ChatShell uses for its wide layout.
const WIDE_QUERY = '(min-width: 900px)';

// The mounted composer's textarea, registered by `useComposerFocus` so
// ChatView's type-to-focus listener can reach it without a prop chain
// (ComposerControls owns the ref).
let activeTextarea: HTMLTextAreaElement | null = null;

/** True when focusing would steal from a field, a dialog or the search box. */
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

/** True when an overlay dialog is open anywhere in the document. */
function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
}

/**
 * Focuses the composer's textarea (WUX-6), unless that would steal focus from
 * a field, a dialog or the search box. Returns whether it focused.
 */
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

/**
 * Registers the composer's textarea and, on a wide layout, focuses it when the
 * open chat changes, as Telegram focuses the composer when a chat opens (and
 * on the first mount).
 */
export function useComposerFocus(
  chatId: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): void {
  const isWide = useMediaQuery(WIDE_QUERY);
  // Read through a ref so the focus effect below depends on `chatId` alone: a
  // narrow↔wide resize must not yank focus into the composer, only a chat
  // change (or the first mount) does.
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
}
