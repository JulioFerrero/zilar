import type { UiMessage } from '@zilar/chat-core';
import { useEffect, useMemo, useRef } from 'react';

export type MessageHandler = (message: UiMessage) => void;

// A handler that keeps its identity while the screen hands over a new closure
// each render, so the memoised bubbles do not re-render for it. It stays
// `undefined` while the screen passes none, because the bubble hides the
// matching action then.
export function useStableHandler(handler: MessageHandler | undefined): MessageHandler | undefined {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const present = handler !== undefined;
  return useMemo(
    () => (present ? (message: UiMessage) => latest.current?.(message) : undefined),
    [present],
  );
}

export type ReactHandler = (message: UiMessage, emoji: string) => void;

export function useStableReact(handler: ReactHandler | undefined): ReactHandler | undefined {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const present = handler !== undefined;
  return useMemo(
    () =>
      present ? (message: UiMessage, emoji: string) => latest.current?.(message, emoji) : undefined,
    [present],
  );
}
