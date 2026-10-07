import type { Payload, Sticker } from '@zilar/protocol';
import { StickerSchema, isValid } from '@zilar/protocol';

import { ApprovalCard } from '@/components/chat/approval-card';
import { ProgressCard } from '@/components/chat/progress-card';

/**
 * Parses the sticker card of a message: a `sticker` payload whose `data`
 * passes `StickerSchema`. Anything invalid falls back to the body text, so a
 * hostile or drifted payload never breaks the list.
 */
export function stickerOf(message: {
  card?: { type: string; data: unknown; v?: number } | undefined;
}): Sticker | undefined {
  const { card } = message;
  if (card === undefined || card.type !== 'sticker') {
    return undefined;
  }
  return isValid(StickerSchema)(card.data) ? card.data : undefined;
}

/** Renders the AI card payloads from `@zilar/protocol`. */
export function PayloadCard({ card }: { card: Payload }) {
  switch (card.type) {
    case 'progress':
      return <ProgressCard data={card.data} />;
    case 'approval.request':
      return <ApprovalCard data={card.data} />;
    default:
      return null;
  }
}
