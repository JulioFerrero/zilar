import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/** The bold marker, as `parseLightInline` reads it. */
const BOLD = '**';
/** The italic marker light markdown accepts at word edges (`_…_`, not `*…*`). */
const ITALIC = '_';
/** The inline-code marker. */
const CODE = '`';

export interface FormattedText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** The marker a Ctrl/Cmd+B, +I or +E applies, or nothing for any other chord. */
function markerFor(event: KeyboardEvent<HTMLTextAreaElement>): string | undefined {
  if (event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  if (key === 'b') {
    return BOLD;
  }
  if (key === 'i') {
    return ITALIC;
  }
  if (key === 'e') {
    return CODE;
  }
  return undefined;
}

/**
 * Wraps the selection in `marker` on both sides, keeping the same text selected.
 * It toggles the marker off when it already wraps the selection: a marker just
 * outside each end, or one at each end inside the selection. An empty selection
 * between markers unwraps too; otherwise it inserts the pair and puts the caret
 * between. Pure and total; it never throws.
 */
export function applyFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): FormattedText {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const selected = value.slice(start, end);

  if (
    start >= marker.length &&
    value.slice(start - marker.length, start) === marker &&
    value.slice(end, end + marker.length) === marker
  ) {
    return {
      value: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length),
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    };
  }

  if (start === end) {
    return {
      value: `${value.slice(0, start)}${marker}${marker}${value.slice(start)}`,
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length,
    };
  }

  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    return {
      value:
        value.slice(0, start) + selected.slice(marker.length, -marker.length) + value.slice(end),
      selectionStart: start,
      selectionEnd: end - marker.length * 2,
    };
  }

  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  };
}

/**
 * Handles the Ctrl/Cmd+B, +I and +E shortcuts for a textarea. `onChange` commits
 * the new text (in the composer it is `mentions.onChange`, so tracked mentions
 * rebase too); the hook restores the selection on the textarea in a layout
 * effect, once React has rendered the new value but before the browser paints,
 * so the range lines up with the new text instead of the default end caret.
 */
export function useFormatShortcut(
  value: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  onChange: (next: string, caret: number) => void,
): (event: KeyboardEvent<HTMLTextAreaElement>) => boolean {
  const pendingRef = useRef<{ start: number; end: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (pending === undefined) {
      return;
    }
    pendingRef.current = undefined;
    textareaRef.current?.setSelectionRange(pending.start, pending.end);
  }, [value, textareaRef]);

  return (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const marker = markerFor(event);
    if (marker === undefined) {
      return false;
    }
    const target = event.currentTarget;
    const next = applyFormat(value, target.selectionStart, target.selectionEnd, marker);
    event.preventDefault();
    pendingRef.current = { start: next.selectionStart, end: next.selectionEnd };
    onChange(next.value, next.selectionEnd);
    return true;
  };
}
