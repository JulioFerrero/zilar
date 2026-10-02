import type { MessageStatus } from '@zilar/chat-core';
import { Check, CheckCheck, Clock } from 'lucide-react';

export function MessageTicks({ status }: { status: MessageStatus }) {
  if (status === 'sending') {
    return <Clock className="size-3.5" aria-label="Sending" />;
  }
  if (status === 'read') {
    return <CheckCheck className="size-3.5" aria-label="Read" />;
  }
  return <Check className="size-3.5" aria-label="Sent" />;
}
