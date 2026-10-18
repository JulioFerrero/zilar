import { useEffect, useRef, useState } from 'react';
import type { UiMessage } from '@zilar/chat-core';

/**
 * Announces only a new incoming message appended to the open chat: history
 * prepends, own sends and the first load are skipped.
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
