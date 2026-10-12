import { useEffect, useRef, useState } from 'react';
import type { UiMessage } from '@zilar/chat-core';

/**
 * WUX-35: a visually hidden live region that announces an incoming message in
 * the open chat. An older history page prepends (the previous last message is
 * still present), my own sends are skipped, and the first population is a
 * history load, so only a new incoming message appended to a loaded chat
 * announces.
 */
export function MessageAnnouncer({
  messages,
  meId,
}: {
  messages: readonly UiMessage[];
  meId: string;
}) {
  const [announcement, setAnnouncement] = useState('');
  const previousLast = useRef<UiMessage | undefined>(undefined);
  useEffect(() => {
    const previous = previousLast.current;
    const last = messages.at(-1);
    previousLast.current = last;
    if (
      previous !== undefined &&
      last !== undefined &&
      last.id !== previous.id &&
      last.senderId !== meId &&
      messages.includes(previous)
    ) {
      setAnnouncement(`New message from ${last.senderName}`);
    }
  }, [messages, meId]);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
}
