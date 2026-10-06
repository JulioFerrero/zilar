import type { ForwardOrigin } from '@zilar/protocol';
import { Forward } from 'lucide-react';

export function ForwardedHeader({ origin }: { origin: ForwardOrigin }) {
  const label =
    origin.chat_name === undefined
      ? `Forwarded from ${origin.sender_name}`
      : `Forwarded from ${origin.sender_name} in ${origin.chat_name}`;
  return (
    <div className="flex items-center gap-1 text-[12px] italic text-muted-foreground">
      <Forward className="size-3.5" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  );
}
